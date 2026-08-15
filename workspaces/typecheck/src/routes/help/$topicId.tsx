/**
 * SPIKE — stock child route of the multi-mounted /help subtree. Exercises
 * both call-site styles: stock `Route.useX()` (home-typed, runtime-patched)
 * and `shared.useX()` (union-typed) side by side on the same runtime state.
 */
import { createFileRoute } from "@tanstack/react-router";
import { shared } from "./$topicId.gen";
import { fetchTopic } from "./-data";

export const Route = createFileRoute("/help/$topicId")({
   loader: ({ params }) => fetchTopic(params.topicId),
   component: TopicDetail,
});

function TopicDetail() {
   // Stock call sites (option B): untouched pre-mount code keeps working.
   const topic = Route.useLoaderData();
   const { topicId } = Route.useParams();
   // Union call site (option A): honest types for cross-mount navigation.
   const navigate = shared.useNavigate();

   return (
      <article>
         <h3>
            {topic.title} ({topicId})
         </h3>
         <p>{topic.body}</p>
         <shared.Link to="..">Back to help</shared.Link>
         <button onClick={() => void navigate({ to: ".." })}>Back</button>
      </article>
   );
}
