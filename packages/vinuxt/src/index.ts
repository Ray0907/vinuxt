import type { Plugin } from "vite";

export const clientOutputConfig = {};
export const clientTreeshakeConfig = { preset: "recommended" as const };

export default function vinuxt(): Plugin[] {
	return [];
}
