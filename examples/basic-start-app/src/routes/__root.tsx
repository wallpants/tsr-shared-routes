/// <reference types="vite/client" />
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import * as React from "react";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        <nav>
          <Link to="/">Home</Link> <Link to="/inventory">Inventory</Link>{" "}
          <Link to="/finances">Finances</Link>
        </nav>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
