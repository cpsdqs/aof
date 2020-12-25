// the constructor lock is broken so here we’ll just disable it

export function setLock(l: boolean) {}
export function getLock() {
    return false;
}
