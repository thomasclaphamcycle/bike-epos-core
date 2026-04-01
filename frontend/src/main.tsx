import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { CustomerAccountProvider } from "./customerAccount/CustomerAccountContext";
import { ToastProvider } from "./components/ToastProvider";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CustomerAccountProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </CustomerAccountProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
