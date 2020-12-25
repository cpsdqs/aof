import { Component, ComponentChildren, h, VNode } from 'preact';
import { useEffect, useState } from 'preact/compat';
import { globalAnimator, lerp, Spring } from 'uikit';
import './icons.less';

// @ts-ignore
import DomainEditable from 'icon!domain-editable';
// @ts-ignore
import DomainPublic from 'icon!domain-public';
// @ts-ignore
import Search from 'icon!search';
// @ts-ignore
import Refresh from 'icon!refresh';
// @ts-ignore
import Add from 'icon!add';
// @ts-ignore
import OpenExternal from 'icon!open-external';
// @ts-ignore
import Download from 'icon!download';
// @ts-ignore
import Downloaded from 'icon!downloaded';
// @ts-ignore
import Lock from 'icon!lock';
// @ts-ignore
import LockUnlocked from 'icon!lock-unlocked';
// @ts-ignore
import Rss from 'icon!rss';
// @ts-ignore
import NoData from 'icon!no-data';
import { ConnState } from '../data';

type Icon = (props: any) => VNode;

export const DomainEditableIcon = DomainEditable as Icon;
export const DomainPublicIcon = DomainPublic as Icon;
export const SearchIcon = Search as Icon;
export const RefreshIcon = Refresh as Icon;
export const AddIcon = Add as Icon;
export const OpenExternalIcon = OpenExternal as Icon;
export const DownloadIcon = Download as Icon;
export const DownloadedIcon = Downloaded as Icon;
export const LockIcon = Lock as Icon;
export const LockUnlockedIcon = LockUnlocked as Icon;
export const RssIcon = Rss as Icon;
export const NoDataIcon = NoData as Icon;

function SvgIcon({ children, ...props }: { children: ComponentChildren, [k: string]: any }): VNode {
    let className = (props.class || '') + ' svg-icon';
    return h('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        ...props,
        class: className,
    }, children);
}

type AnimationHook = { targets: Set<Spring>, update: (d: number) => void, owner: Component };
function useAnimationHook(owner: Component): AnimationHook {
    const [hook, setHook] = useState<AnimationHook | null>(null);

    let t = hook;
    if (!t) {
        t = {
            targets: new Set(),
            update (dt) {
                let wantsUpdate = false;
                for (const target of this.targets) {
                    target.update(dt);
                    if (!wantsUpdate && target.wantsUpdate()) wantsUpdate = true;
                }
                if (!wantsUpdate) globalAnimator.deregister(this);
                this.owner.forceUpdate();
            },
            owner,
        };
        useEffect(() => setHook(t));
    }

    return t;
}

function useSpring(animation: AnimationHook, f: number, dr: number, target: number, initial?: number): number {
    let value = Number.isFinite(initial) ? initial : target;
    const [spring] = useState<Spring>(new Spring(f, dr, value));

    let s = spring;
    animation.targets.add(s!);
    globalAnimator.register(animation);
    if (target !== s.target) s.target = target;
    value = s.value;

    return value;
}

export function CollapsedIcon(this: Component, { collapsed }: { collapsed: boolean }) {
    const anim = useAnimationHook(this);
    const c = useSpring(anim, 0.6, 0.3, collapsed ? 1 : 0);

    const arrowOuterTop = `translateY(${c * 7}px)`;
    const arrowOuterBottom = `translateY(${c * -7}px)`;

    const arrowInnerTop = `translateY(${(1 - c) * -4}px)`;
    const arrowInnerBottom = `translateY(${(1 - c) * 4}px)`;

    const rectTop = lerp(6, 1, c);
    const rectBot = lerp(10, 15, c);

    return (
        <SvgIcon>
            <defs>
                {/* clip path that shows everything outside the box */}
                <clipPath id="outer">
                    <rect x={0} y={rectTop - 10} width={16} height={10} />
                    <rect x={0} y={rectBot} width={16} height={10} />
                </clipPath>
                {/* only inside the box */}
                <clipPath id="inner">
                    <rect x={0} y={rectTop} width={16} height={rectBot - rectTop} />
                </clipPath>
            </defs>
            <g clip-path="url(#outer)">
                <path
                    fill="currentColor"
                    style={{ transform: arrowOuterTop }}
                    d="M5.91421356,0.5 L10.0857864,0.5 C10.6380712,0.5 11.0857864,0.94771525 11.0857864,1.5 C11.0857864,1.76521649 10.9804296,2.0195704 10.7928932,2.20710678 L8.70710678,4.29289322 C8.31658249,4.68341751 7.68341751,4.68341751 7.29289322,4.29289322 L5.20710678,2.20710678 C4.81658249,1.81658249 4.81658249,1.18341751 5.20710678,0.792893219 C5.39464316,0.60535684 5.64899707,0.5 5.91421356,0.5 Z" />
                <path
                    fill="currentColor"
                    style={{ transform: arrowOuterBottom }}
                    d="M5.91421356,15 L10.0857864,15 C10.6380712,15 11.0857864,14.5522847 11.0857864,14 C11.0857864,13.7347835 10.9804296,13.4804296 10.7928932,13.2928932 L8.70710678,11.2071068 C8.31658249,10.8165825 7.68341751,10.8165825 7.29289322,11.2071068 L5.20710678,13.2928932 C4.81658249,13.6834175 4.81658249,14.3165825 5.20710678,14.7071068 C5.39464316,14.8946432 5.64899707,15 5.91421356,15 Z" />
            </g>
            <rect x={2} width={12} y={rectTop} height={rectBot - rectTop} rx={1} stroke="currentColor" fill="none" />
            <g clip-path="url(#inner)">
                <path
                    fill="currentColor"
                    style={{ transform: arrowInnerTop }}
                    d="M5.91421356,7 L10.0857864,7 C10.6380712,7 11.0857864,6.55228475 11.0857864,6 C11.0857864,5.73478351 10.9804296,5.4804296 10.7928932,5.29289322 L8.70710678,3.20710678 C8.31658249,2.81658249 7.68341751,2.81658249 7.29289322,3.20710678 L5.20710678,5.29289322 C4.81658249,5.68341751 4.81658249,6.31658249 5.20710678,6.70710678 C5.39464316,6.89464316 5.64899707,7 5.91421356,7 Z" />
                <path
                    fill="currentColor"
                    style={{ transform: arrowInnerBottom }}
                    d="M5.91421356,9 L10.0857864,9 C10.6380712,9 11.0857864,9.44771525 11.0857864,10 C11.0857864,10.2652165 10.9804296,10.5195704 10.7928932,10.7071068 L8.70710678,12.7928932 C8.31658249,13.1834175 7.68341751,13.1834175 7.29289322,12.7928932 L5.20710678,10.7071068 C4.81658249,10.3165825 4.81658249,9.68341751 5.20710678,9.29289322 C5.39464316,9.10535684 5.64899707,9 5.91421356,9 Z" />
            </g>
        </SvgIcon>
    );
}

export function AllReadIcon(this: Component, { read }: { read: boolean }) {
    const anim = useAnimationHook(this);
    const r = useSpring(anim, 0.6, 0.3, read ? 1 : 0);

    const circleStyle = {
        transformOrigin: '12px 11px',
        transform: `scale(${1 - r})`,
    };
    const checkStyle = {
        transformOrigin: '12px 11px',
        transform: `scale(${r})`,
    };

    return (
        <SvgIcon>
            <g stroke="currentColor" stroke-width="1" stroke-linecap="round">
                <line x1="2.5" y1="4.5" x2="13.5" y2="4.5" />
                <line x1="2.5" y1="7.5" x2={lerp(13.5, 10.5, r)} y2="7.5" />
                <line x1="2.5" y1="10.5" x2={lerp(8.5, 4.5, r)} y2="10.5" />
            </g>
            <circle fill="currentColor" cx="12" cy="11" r="2" style={circleStyle} />
            <polyline
                fill="none"
                stroke="currentColor"
                stroke-linejoin="round"
                points="7 10.7058824 9.72222222 14 14 7"
                style={checkStyle} />
        </SvgIcon>
    );
}

export function ConnectionIcon(this: Component, { state }: { state: ConnState | null }) {
    state = state || ConnState.Closed;

    const anim = useAnimationHook(this);
    const slash = useSpring(anim, 0.6, 0.3, state === ConnState.Closed
        ? 1 : state === ConnState.Closing ? 0.5 : 0);
    const connecting = useSpring(anim, 0.6, 0.3, state === ConnState.Opening ? 1 : 0);
    const connected = useSpring(anim, 0.6, 0.3, state === ConnState.Open ? 1 : 0);

    const cloud = 'M8,3.5 C8.806884,3.5 9.55004907,3.77295418 10.142008,4.23176413 C10.7471191,4.7007679 11.1945902,5.36365023 11.3904958,6.12747742 C12.7581247,6.50186069 13.5379538,6.83152133 14.0982861,7.37200122 C14.660488,7.91428455 15,8.66754842 15,9.5 C15,10.2985791 14.687993,11.0242956 14.179185,11.5618444 C13.6704132,12.0993551 12.9649435,12.4489204 12.1778675,12.4948295 L12.1778675,12.4948295 L3.5,12.5 C2.80964406,12.5 2.18464406,12.220178 1.73223305,11.767767 C1.27982203,11.3153559 1,10.6903559 1,10 C1,9.30964406 1.27982203,8.68464406 1.73223305,8.23223305 C2.18464406,7.77982203 2.80964406,7.5 3.5,7.5 L3.5,7.5 L4.50213022,7.63305198 L4.50168679,7.04138801 C4.50094897,6.05689765 4.89037712,5.17220919 5.52253729,4.53317934 C6.15570627,3.89312972 7.03196055,3.5 8,3.5 L8,3.5 Z';

    const checkStyle = {
        transformOrigin: '8px 10px',
        transform: `scale(${connected})`,
    };

    return (
        <SvgIcon>
            <mask id="cloud-fill-mask">
                <rect x="0" y="0" width="16" height="16" fill="white" />
                {/* remove fill if disconnected */}
                <circle fill="black" cx="5" cy="11" r={lerp(0, 3 * 2, Math.max(0, slash))} />
                <circle fill="black" cx="9" cy="11" r={lerp(0, 4 * 2, Math.max(0, slash))} />
                {/* "connecting" dots */}
                <circle fill="black" cx="5" cy="10" r={Math.max(0, connecting)} />
                <circle fill="black" cx="8" cy="10" r={Math.max(0, connecting)} />
                <circle fill="black" cx="11" cy="10" r={Math.max(0, connecting)} />
                {/* check mark */}
                <polyline
                    style={checkStyle}
                    fill="none"
                    stroke="black"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    points="5.5 9.5 7.5 11.5 10.5 7.5" />
            </mask>
            <mask id="cloud-stroke-mask">
                <rect x="0" y="0" width="16" height="16" fill="white" />
                {/* cut out the slash */}
                <line
                    x1="3.5" y1="14.5"
                    x2={lerp(3.5, 13.5, slash)} y2={lerp(14.5, 3.5, slash)}
                    stroke="black" stroke-width="3" stroke-linecap="round" />
            </mask>
            <path
                id="cloud-outline"
                mask="url(#cloud-stroke-mask)"
                fill="none"
                stroke="currentColor"
                d={cloud} />
            <path
                id="cloud-fill"
                mask="url(#cloud-fill-mask)"
                fill="currentColor"
                d={cloud} />
            <line
                x1="3.5" y1="14.5"
                x2={lerp(3.5, 13.5, slash)} y2={lerp(14.5, 3.5, slash)}
                stroke="currentColor"
                stroke-width={Math.min(1, slash * 15)} // approx. length
                stroke-linecap="round" />
        </SvgIcon>
    );
}
