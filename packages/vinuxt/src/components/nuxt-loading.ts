/**
 * NuxtLoadingIndicator component.
 *
 * Shows a CSS-based progress bar at the top of the page during navigation.
 * Uses vue-router's beforeEach/afterEach hooks to detect navigation start/end.
 *
 * Props:
 * - color    -- progress bar color (CSS color string)
 * - height   -- progress bar height in pixels
 * - duration -- estimated duration in ms (controls CSS animation speed)
 * - throttle -- delay before showing the bar (avoids flash on fast navigations)
 */

import {
	defineComponent,
	h,
	ref,
	onMounted,
	onUnmounted,
	type PropType,
} from "vue";
import { useRouter } from "vue-router";

export default defineComponent({
	name: "NuxtLoadingIndicator",

	props: {
		color: {
			type: String,
			default: "#00dc82",
		},
		height: {
			type: Number,
			default: 3,
		},
		duration: {
			type: Number,
			default: 2000,
		},
		throttle: {
			type: Number,
			default: 200,
		},
	},

	setup(props) {
		const is_loading = ref(false);
		const progress = ref(0);

		let timer_throttle: ReturnType<typeof setTimeout> | null = null;
		let timer_progress: ReturnType<typeof setInterval> | null = null;
		let remove_before_each: (() => void) | null = null;
		let remove_after_each: (() => void) | null = null;

		function start(): void {
			// Clear any existing timers
			stop();

			// Throttle: delay showing the bar
			timer_throttle = setTimeout(() => {
				is_loading.value = true;
				progress.value = 0;

				// Simulate progress with an easing curve
				timer_progress = setInterval(() => {
					// Slow down as we approach 90%
					const remaining = 90 - progress.value;
					const increment = remaining * 0.1;
					progress.value = Math.min(
						progress.value + increment,
						90,
					);
				}, props.duration / 20);
			}, props.throttle);
		}

		function stop(): void {
			if (timer_throttle) {
				clearTimeout(timer_throttle);
				timer_throttle = null;
			}
			if (timer_progress) {
				clearInterval(timer_progress);
				timer_progress = null;
			}

			if (is_loading.value) {
				// Finish: jump to 100% then hide
				progress.value = 100;
				setTimeout(() => {
					is_loading.value = false;
					progress.value = 0;
				}, 200);
			} else {
				is_loading.value = false;
				progress.value = 0;
			}
		}

		onMounted(() => {
			const router = useRouter();

			remove_before_each = router.beforeEach((_to, _from, next) => {
				start();
				next();
			});

			remove_after_each = router.afterEach(() => {
				stop();
			});
		});

		onUnmounted(() => {
			stop();
			if (remove_before_each) remove_before_each();
			if (remove_after_each) remove_after_each();
		});

		return () => {
			if (!is_loading.value) return null;

			return h("div", {
				style: {
					position: "fixed",
					top: "0",
					left: "0",
					right: "0",
					height: `${props.height}px`,
					zIndex: "999999",
					pointerEvents: "none",
					backgroundColor: props.color,
					width: `${progress.value}%`,
					transition: "width 0.1s ease-out, opacity 0.2s ease",
					opacity: progress.value >= 100 ? "0" : "1",
				},
				role: "progressbar",
				"aria-valuenow": progress.value,
				"aria-valuemin": 0,
				"aria-valuemax": 100,
			});
		};
	},
});
