/**
 * NuxtImg component.
 *
 * Simple wrapper that renders an <img> tag with lazy loading by default.
 * This is a baseline implementation -- @unpic/vue integration for
 * responsive images and CDN optimization comes later.
 *
 * Props:
 * - src     -- image source URL
 * - alt     -- alternative text
 * - width   -- image width (number or string)
 * - height  -- image height (number or string)
 * - loading -- loading strategy, defaults to "lazy"
 */

import { defineComponent, h, type PropType } from "vue";

export default defineComponent({
	name: "NuxtImg",

	props: {
		src: {
			type: String,
			required: true,
		},
		alt: {
			type: String,
			default: "",
		},
		width: {
			type: [Number, String] as PropType<number | string>,
			default: undefined,
		},
		height: {
			type: [Number, String] as PropType<number | string>,
			default: undefined,
		},
		loading: {
			type: String as PropType<"lazy" | "eager">,
			default: "lazy",
		},
	},

	setup(props) {
		return () => {
			const attrs: Record<string, unknown> = {
				src: props.src,
				alt: props.alt,
				loading: props.loading,
			};

			if (props.width !== undefined) {
				attrs.width = props.width;
			}
			if (props.height !== undefined) {
				attrs.height = props.height;
			}

			return h("img", attrs);
		};
	},
});
