/**
 * NuxtPage component.
 *
 * Thin wrapper around vue-router's RouterView with optional Suspense
 * and Transition support for async page components.
 *
 * Props:
 * - transition -- transition name (string) or false to disable
 * - keepalive  -- whether to wrap in KeepAlive
 */

import {
	defineComponent,
	h,
	Suspense,
	Transition,
	KeepAlive,
	type PropType,
	type VNode,
} from "vue";
import { RouterView } from "vue-router";

export default defineComponent({
	name: "NuxtPage",

	props: {
		transition: {
			type: [String, Boolean] as PropType<string | false>,
			default: undefined,
		},
		keepalive: {
			type: Boolean,
			default: false,
		},
	},

	setup(props) {
		return () => {
			return h(RouterView, null, {
				default: ({ Component }: { Component: VNode | null }) => {
					if (!Component) return null;

					// Build the component tree inside-out:
					// Component -> KeepAlive? -> Transition? -> Suspense
					let inner: VNode = h(Component);

					// Wrap in KeepAlive if requested
					if (props.keepalive) {
						inner = h(KeepAlive, null, () => inner);
					}

					// Wrap in Transition if a name is provided
					if (
						props.transition !== false &&
						props.transition !== undefined
					) {
						inner = h(
							Transition,
							{
								name: props.transition,
								mode: "out-in",
							},
							() => inner,
						);
					}

					// Always wrap in Suspense for async component support
					return h(Suspense, null, {
						default: () => inner,
					});
				},
			});
		};
	},
});
