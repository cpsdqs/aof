// @ts-ignore -- for IDEs thinking this isn't inside node_modules
import { Component, ComponentChild } from 'preact';

export class EventEmitter {
    on(event: string, callback: (...any) => void);
    removeListener(event: string, callback: (...any) => void);
    emit(event: string, ...args: any[]);
}

export interface AnimationTarget {
    update(dt: number): void;
}

export const globalAnimator: {
    register: (target: AnimationTarget) => void,
    deregister: (target: AnimationTarget) => void,

    stop: () => void,
    start: () => void,
    animationSpeed: number,
};
export class Spring implements AnimationTarget {
    tolerance: number;
    locked: boolean;
    value: number;
    velocity: number;
    target: number;
    update(dt: number);
    wantsUpdate(): boolean;
    finish();
    constructor(dampingRatio?: number, period?: number, initial?: number);
    getDampingRatio(): number;
    getPeriod(): number;
    setDampingRatioAndPeriod(period: number, ratio: number);
    setPeriod(period: number);
    setDampingRatio(ratio: number);
}
export function lerp(a: number, b: number, t: number): number;
export function clamp(x: number, l: number, h: number): number;

export class Checkbox extends Component<Checkbox.Props> {}
export namespace Checkbox {
    interface Props {
        checked?: boolean,
        onChange?: (checked: boolean) => void,
        [other: string]: any,
    }
}

export class Progress extends Component<Progress.Props> {}
export namespace Progress {
    interface Props {
        block?: boolean,
        lines?: number,
    }
}
export class TaskButton extends Component<TaskButton.Props> {
    run(e?: any);
    showError(error: any, action?: { run: () => void, label: string });
    showAction(label: string, run: () => Promise<void>);
}
export namespace TaskButton {
    interface Props {
        run: () => Promise<void>,
        loading?: boolean,
        disabled?: boolean,
        [other: string]: any,
    }
}
export class TextField extends Component<TextField.Props> {
    input: { current: HTMLInputElement|null };
}
export namespace TextField {
    interface Props {
        value: string,
        onChange: (value: string) => void,
        autocomplete?: string,
        onKeyDown?: (KeyboardEvent) => void,
        onKeyPress?: (KeyboardEvent) => void,
        onKeyUp?: (KeyboardEvent) => void,
        onFocus?: (FocusEvent) => void,
        onBlur?: (BlurEvent) => void,
        [other: string]: any,
    }
}
export class Switch extends Component<Switch.Props> {}
export namespace Switch {
    interface Props {
        value: string,
        onChange: (value: string) => void,
        options: { label: ComponentChild, value: string }[]
    }
}
