import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// NOTE: React.StrictMode is intentionally omitted. StrictMode double-invokes
// useEffect in development, which causes every TerminalTab to spawn, kill, and
// re-spawn its PTY process. With N saved tabs that means 2N PowerShell processes
// starting simultaneously — each taking 1–3 s on Windows — which freezes the app
// for several seconds on startup. PTY processes are external OS resources that
// cannot be cheaply re-created, so the StrictMode "run cleanup → re-run effect"
// cycle provides no benefit here and only causes visible freezing.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
