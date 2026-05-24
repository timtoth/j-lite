interface TcApi {
  pickFolder: () => Promise<string | null>;
  getServerPort: () => Promise<number>;
}

interface Window {
  tc?: TcApi;
}
