import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Button } from "#/components/button.tsx";

export const Route = createFileRoute("/home")({
   component: RouteComponent,
});

function RouteComponent() {
   return (
      <>
         <div className="bg-amber-200 h-screen w-screen text-black">
            <div className="mx-auto pt-10 w-40 flex justify-between">
               <Button variant="link" nativeButton={false} render={<Link to="/home">Home</Link>} />
               <Button
                  variant="link"
                  nativeButton={false}
                  render={<Link to="/about">About</Link>}
               />
            </div>
            <p className="text-[100px] text-center">Home</p>
            <div className="mx-auto w-fit">
               <Button
                  nativeButton={false}
                  render={<Link to="/home/shared-one">/home/shared-one</Link>}
               />
               <Button
                  nativeButton={false}
                  render={<Link to="/home/shared-two">/home/shared-two</Link>}
               />
            </div>
            <div className="mx-auto w-fit">
               <Button
                  nativeButton={false}
                  render={
                     <Link to="/home/$sharedOneChild" params={{ sharedOneChild: 123 }}>
                        {`/home/$sharedOneChild params={{sharedOneChild: 123}}`}
                     </Link>
                  }
               />
            </div>
         </div>
         <Outlet />
      </>
   );
}
