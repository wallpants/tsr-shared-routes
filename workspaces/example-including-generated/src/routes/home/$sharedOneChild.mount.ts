import { mount } from "tsr-shared-routes";

// Overlapping sources: shared-one's child subtree, mounted directly at
// /home/$sharedOneChild (its home stays /home/shared-one/$sharedOneChild).
export default mount("./shared-one/$sharedOneChild");
