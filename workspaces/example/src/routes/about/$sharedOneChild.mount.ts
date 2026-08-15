import { mount } from "tsr-shared-routes";

// Overlapping sources: this mounts a SUBTREE of the already-mounted
// shared-one directly at /about/$sharedOneChild.
export default mount("../home/shared-one/$sharedOneChild");
