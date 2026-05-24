export interface Ticket {
  id: string;
  key: string;
  title: string;
  status: string;
  url: string;
}

export interface Epic {
  id: string;
  key: string;
  title: string;
  status: string;
  url: string;
}

export interface EpicChild {
  id: string;
  key: string;
  title: string;
  status: string;
  url: string;
  assignee: string;
}
