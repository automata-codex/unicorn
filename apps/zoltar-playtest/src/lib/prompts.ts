// Prompt file discovery and loading using Vite's import.meta.glob.
// Files live in ../../prompts/ relative to this module.

const generalWardenModules = import.meta.glob<string>(
	'../../prompts/general-warden-*.txt',
	{ query: '?raw', import: 'default', eager: true }
);

const mothershipModules = import.meta.glob<string>(
	'../../prompts/mothership-*.txt',
	{ query: '?raw', import: 'default', eager: true }
);

type PromptFile = {
	filename: string;
	content: string;
};

function extractFilename(path: string): string {
	return path.split('/').pop() ?? path;
}

function extractVersion(filename: string): number {
	const match = filename.match(/v(\d+)/);
	return match ? parseInt(match[1]) : 0;
}

function buildList(modules: Record<string, string>): PromptFile[] {
	return Object.entries(modules)
		.map(([path, content]) => ({
			filename: extractFilename(path),
			content
		}))
		.sort((a, b) => extractVersion(a.filename) - extractVersion(b.filename));
}

export const generalWardenPrompts: PromptFile[] = buildList(generalWardenModules);
export const mothershipPrompts: PromptFile[] = buildList(mothershipModules);

export function getDefaultPrompt(list: PromptFile[]): PromptFile | null {
	return list.length > 0 ? list[list.length - 1] : null;
}

export function getPromptByFilename(list: PromptFile[], filename: string): PromptFile | null {
	return list.find((p) => p.filename === filename) ?? null;
}
