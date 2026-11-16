export interface ClearableMessage {
	id: string;
	createdTimestamp: number;
	author: { id: string };
}

export type ClearMode = 'user' | 'amount' | 'all';

export interface CollectedMessages<MessageType extends ClearableMessage> {
	messages: MessageType[];
	olderMessagesSkipped: boolean;
}

const DISCORD_BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DISCORD_BULK_DELETE_BATCH_SIZE = 100;
const MAX_CLEAR_AMOUNT = 100;

export async function collectMessagesForClear<MessageType extends ClearableMessage>(
	fetchPage: (before?: string) => Promise<readonly MessageType[]>,
	mode: ClearMode,
	amount?: number,
	userId?: string,
	now = Date.now()
): Promise<CollectedMessages<MessageType>> {
	if (mode !== 'all' && (!Number.isInteger(amount) || amount === undefined || amount < 1 || amount > MAX_CLEAR_AMOUNT)) {
		throw new RangeError(`The clear amount must be an integer from 1 to ${MAX_CLEAR_AMOUNT}.`);
	}
	if (mode === 'user' && !userId) throw new TypeError('A user ID is required for user message cleanup.');

	const cutoff = now - DISCORD_BULK_DELETE_MAX_AGE_MS;
	const messages: MessageType[] = [];
	let olderMessagesSkipped = false;
	let before: string | undefined;

	while (true) {
		const page = [...(await fetchPage(before))].sort((left, right) => right.createdTimestamp - left.createdTimestamp);
		if (page.length === 0) break;

		if (mode === 'amount') {
			for (const message of page.slice(0, amount)) {
				if (message.createdTimestamp <= cutoff) {
					olderMessagesSkipped = true;
				} else {
					messages.push(message);
				}
			}
			break;
		}

		let reachedAgeLimit = false;
		let reachedAmount = false;
		for (const message of page) {
			if (message.createdTimestamp <= cutoff) {
				olderMessagesSkipped = true;
				reachedAgeLimit = true;
				break;
			}

			if (mode === 'all' || message.author.id === userId) messages.push(message);
			if (mode === 'user' && messages.length === amount) {
				reachedAmount = true;
				break;
			}
		}

		if (reachedAgeLimit || reachedAmount || page.length < DISCORD_BULK_DELETE_BATCH_SIZE) break;

		const oldestMessage = page[page.length - 1];
		if (oldestMessage.id === before) throw new Error('Message history pagination did not advance.');
		before = oldestMessage.id;
	}

	return { messages, olderMessagesSkipped };
}
