import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

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
               <Link to="/">Home</Link> <Link to="/help">Help</Link>{" "}
               <Link to="/inventory">Inventory</Link>
            </nav>
            <Outlet />
            <Scripts />
         </body>
      </html>
   );
}
