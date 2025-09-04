import { firstValueFrom, timer } from "rxjs";


export function sleep(ms:number):Promise<true> {
	return new Promise(resolve=>{
		setTimeout(()=>resolve(true), ms)
	});
}