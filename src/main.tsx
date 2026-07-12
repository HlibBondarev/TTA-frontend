import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./store";
import { db } from "./db/ttaDatabase";
import App from "./App.tsx";
import "./index.css";

// Force explicit database connection to trigger IndexedDB schema creation immediately
db.open()
  .then(() => {
    console.log(
      `[IndexedDB] ${db.name} successfully connected and schema version ${db.verno} is active.`,
    );
  })
  .catch((err) => {
    console.error(`[IndexedDB] Critical error opening database:`, err);
  });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
