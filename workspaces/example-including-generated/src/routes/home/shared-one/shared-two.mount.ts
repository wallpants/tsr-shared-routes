import { mount } from "tsr-shared-routes";

// Nested mount: this file lives INSIDE the mounted shared-one subtree, so
// shared-two mounts at /home/shared-one/shared-two AND is mirrored under
// every mount of shared-one (/about/shared-one/shared-two).
export default mount("../shared-two");
