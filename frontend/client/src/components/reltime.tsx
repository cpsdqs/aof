import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import get from '../locale';

function getRelativeTime(timestamp: any, useDays: boolean, def: string) {
    if (!timestamp) return def;

    if (typeof timestamp === 'string' && !timestamp.includes('T')) {
        // date only
        useDays = true;
    }

    const t = new Date(timestamp);
    const now = new Date();

    if (useDays) {
        const tDay = new Date(t.getFullYear(), t.getMonth(), t.getDate());
        const nDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const dd = Math.round((+tDay - +nDay) / 86400000);
        const dy = Math.trunc(dd / 365.2425); // close enough

        if (!Number.isFinite(dd)) return get('time.reltime.unknown');

        const prefix = dd > 0 ? get('time.reltime.prefix_fut') : get('time.reltime.prefix_past');
        const suffix = dd > 0 ? get('time.reltime.suffix_fut') : get('time.reltime.suffix_past');

        if (Math.abs(dd) > 360 && dy) return prefix + Math.abs(dy) + get('time.reltime.units.years') + suffix;

        if (!dd) return get('time.reltime.today');
        if (dd === -1) return get('time.reltime.yesterday');
        if (dd === 1) return get('time.reltime.tomorrow');
        return prefix + Math.abs(dd) + get('time.reltime.units.days') + suffix;
    }

    const ds = (+t - +now) / 1000;

    if (!Number.isFinite(ds)) return get('time.reltime.unknown');

    let prefix = ds > 0 ? get('time.reltime.prefix_fut') : get('time.reltime.prefix_past');
    let suffix = ds > 0 ? get('time.reltime.suffix_fut') : get('time.reltime.suffix_past');

    const ads = Math.abs(ds);

    if (ads <= 1) return get('time.reltime.just_now');

    const secs = Math.floor(ads) % 60;
    const mins = Math.floor(ads / 60) % 60;
    const hrs = Math.floor(ads / 3600) % 24;
    const days = Math.floor(ads / 86400);

    let out = prefix;
    if (days) out += `${days}${get('time.reltime.units.days')} `;
    if (days || hrs) out += `${hrs}${get('time.reltime.units.hours')} `;
    if (!days && (hrs || mins)) out += `${mins}${get('time.reltime.units.minutes')} `;
    else if (!days) out += `${secs}${get('time.reltime.units.seconds')}`;
    return out + suffix;
}

const relativeTimestamps: Set<RelTime> = new Set();

export default class RelTime extends PureComponent<RelTime.Props> {
    state = {
        time: getRelativeTime(this.props.time, this.props.days || false, this.props.default || ''),
    };

    componentDidMount () {
        relativeTimestamps.add(this);
    }

    componentWillUnmount () {
        relativeTimestamps.delete(this);
    }

    componentDidUpdate (prevProps: RelTime.Props) {
        if (prevProps.time !== this.props.time) this.update();
    }

    update () {
        this.setState({ time: getRelativeTime(this.props.time, this.props.days || false, this.props.default || '') });
    }

    render () {
        return this.state.time;
    }
}

namespace RelTime {
    export interface Props {
        time: any,
        days?: boolean,
        default?: string,
    }
}

// TODO: only run timer if necessary
setInterval(() => {
    for (const f of relativeTimestamps) f.update();
}, 10000);
