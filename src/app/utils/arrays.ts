export function extractFrom<T>(array:T[], condition:(item:T)=>boolean, extractedMaxSize:number=-1):T[] {
	const extracted = [];
	for (let i = 0; i < array.length; i++) {
		if (condition(array[i])) {
			const [item] = array.splice(i, 1);
			extracted.push(item);
			i--;
			if (extractedMaxSize > -1 && extracted.length >= extractedMaxSize) break;
		}
	}
	return extracted;
}

export function first<T>(array:T[]):T {
	return (array || []).slice(0)[0];
}

export function last<T>(array:T[]):T {
	return (array || []).slice(-1)[0];
}

export function unique(array:any[]) {
	return Array.from(new Set(array));
}

export function hasDuplicates(array:any[]) {
	return array.length != unique(array).length;
}