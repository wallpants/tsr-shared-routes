import { Button } from "#/components/button.tsx";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <div className="bg-purple-200 h-screen w-screen text-black">
        <div className="mx-auto pt-10 w-40 flex justify-between">
          <Button variant="link" nativeButton={false} render={<Link to="/home">Home</Link>} />
          <Button variant="link" nativeButton={false} render={<Link to="/about">About</Link>} />
        </div>
        <p className="text-[100px] text-center">About</p>
        <div className="mx-auto w-fit">
          <Button
            nativeButton={false}
            render={<Link to="/about/shared-one">/about/shared-one</Link>}
          />
          <Button
            nativeButton={false}
            render={<Link to="/about/shared-two">/about/shared-two</Link>}
          />
        </div>
        <div className="mx-auto w-fit">
          <Button
            nativeButton={false}
            render={
              <Link to="/about/$sharedOneChild" params={{ sharedOneChild: 456 }}>
                {`/about/$sharedOneChild params={{sharedOneChild: 456}}`}
              </Link>
            }
          />
        </div>
      </div>
      <Outlet />
    </>
  );
}
