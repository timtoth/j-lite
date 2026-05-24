import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type ChatRole = "user" | "assistant";

export interface ChatMessageData {
  role: ChatRole;
  content: string;
  error?: boolean;
}

interface Props {
  message: ChatMessageData;
}

export function ChatMessage({ message }: Props) {
  const classes = ["chat-message", `chat-message--${message.role}`];
  if (message.error) classes.push("chat-message--error");

  return (
    <div className={classes.join(" ")}>
      <div className="chat-message-bubble">
        {message.role === "assistant" && !message.error ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) =>
              /^(https?:|mailto:|#|\/|\.)/i.test(url) ? url : ""
            }
          >
            {message.content}
          </ReactMarkdown>
        ) : (
          <span className="chat-message-plain">{message.content}</span>
        )}
      </div>
    </div>
  );
}
