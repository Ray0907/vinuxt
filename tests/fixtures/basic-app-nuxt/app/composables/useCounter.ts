import { ref } from "vue";

export function useCounter(initial = 0) {
	const count = ref(initial);
	const increment = () => count.value++;
	const decrement = () => count.value--;
	return { count, increment, decrement };
}
