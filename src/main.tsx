import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { Auth0Provider } from "@auth0/auth0-react";
import { store } from "./store";
import { db } from "./db/ttaDatabase";
import App from "./App.tsx";
import "./index.css";

try {
  await db.open();
  console.log(
    `[IndexedDB] ${db.name} successfully connected and schema version ${db.verno} is active.`,
  );
} catch (err) {
  console.error(`[IndexedDB] Critical error opening database:`, err);
}

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: audience,
      }}
      useRefreshTokens={true}
    >
      <Provider store={store}>
        <App />
      </Provider>
    </Auth0Provider>
  </StrictMode>,
);
