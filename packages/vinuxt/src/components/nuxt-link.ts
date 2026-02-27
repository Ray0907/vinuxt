/**
 * NuxtLink component.
 *
 * Wraps vue-router's RouterLink for internal paths and renders a plain <a>
 * tag for external URLs.
 *
 * External detection: starts with "http://", "https://", or "//".
 *
 * Props:
 * - to       -- route location (string or object) for internal links
 * - href     -- alias for `to` (convenience for external links)
 * - target   -- HTML target attribute (e.g. "_blank")
 * - external -- force external link rendering
 * - prefetch -- hint for link prefetching (reserved for future use)
 */

import { defineComponent, h, computed, type PropType } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";

function isExternalUrl(url: string): boolean {
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("//")
  );
}

export default defineComponent({
  name: "NuxtLink",

  props: {
    to: {
      type: [String, Object] as PropType<RouteLocationRaw>,
      default: undefined,
    },
    href: {
      type: String,
      default: undefined,
    },
    target: {
      type: String,
      default: undefined,
    },
    external: {
      type: Boolean,
      default: false,
    },
    prefetch: {
      type: Boolean,
      default: undefined,
    },
  },

  setup(props, { slots }) {
    const resolved_to = computed(() => props.to ?? props.href ?? "/");

    const is_external = computed(() => {
      if (props.external) return true;
      const value = resolved_to.value;
      if (typeof value === "string") {
        return isExternalUrl(value);
      }
      return false;
    });

    return () => {
      if (is_external.value) {
        // Render a plain <a> tag for external links
        const href =
          typeof resolved_to.value === "string" ? resolved_to.value : "/";

        const attrs: Record<string, unknown> = { href };
        if (props.target) {
          attrs.target = props.target;
        }
        // Add rel="noopener noreferrer" for _blank targets
        if (props.target === "_blank") {
          attrs.rel = "noopener noreferrer";
        }

        return h("a", attrs, slots.default?.());
      }

      // Render vue-router's RouterLink for internal navigation
      const link_props: Record<string, unknown> = {
        to: resolved_to.value,
      };
      if (props.target) {
        link_props.target = props.target;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return h(RouterLink as any, link_props, slots);
    };
  },
});
