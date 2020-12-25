import { h } from 'preact';
import { Progress, TaskButton } from 'uikit';
import standalone from '../standalone';
import get from '../locale';
import { Route } from '../router';
import './header.less';
import { AOFC_SESSION_STATE, connect, CONNECTION_STATE } from '../data';
import { ConnectionIcon, LockIcon, LockUnlockedIcon } from './icons';
import { getSession } from '../data/aofc';

interface HeaderProps {
    route: Route,
    navigate: (p: string) => void,
}

export default function Header({ route, navigate }: HeaderProps) {
    const routeParts = [];
    let routePath = '';
    let lastTarget = '';
    for (const p of route) {
        const arrowTarget = lastTarget;
        routeParts.push(
            <li
                key={`${p.id}-a`}
                onClick={() => navigate(arrowTarget)}
                class="route-arrow" />);
        routePath += p.raw;
        const target = routePath;
        lastTarget = target;
        routeParts.push(
            <li
                class="route-item"
                onClick={() => navigate(target)}
                key={p.id}>
                {p.title}
            </li>
        );
    }

    return (
        <div class="app-header">
            <ul class="app-route">
                <li class="route-item" onClick={() => navigate('')}>
                    <img class="route-icon" src="../static/icon.svg" />
                </li>
                {routeParts}
            </ul>
            <div class="header-status-container">
                <HeaderStatus />
                {standalone ? (
                    <a onClick={() => window.location.reload()}>{get('header.reload')}</a>
                ) : (
                    <a href="..">{get('header.exit')}</a>
                )}
            </div>
        </div>
    );
}

function HeaderStatus() {
    return connect(CONNECTION_STATE, conn => connect(AOFC_SESSION_STATE, aofcState => {
        let connState;
        let cryptoState;
        {
            connState = (
                <div class="conn-state">
                    <ConnectionIcon state={conn.get()} />
                </div>
            );
        }
        if (aofcState.loaded) {
            const state = aofcState.get()!;
            if (state.user_canceled) {
                cryptoState = (
                    <TaskButton class="manual-decrypt-button" run={async () => {
                        await getSession(true);
                    }}>
                        <span class="manual-decrypt-label">
                            {get('login.decrypt.manual_decrypt')}
                        </span>
                        <LockIcon />
                    </TaskButton>
                );
            } else if (state.ready) {
                if (state.decrypting || state.encrypting) {
                    cryptoState = <Progress />;
                } else {
                    cryptoState = <LockUnlockedIcon />;
                }
            } else if (state.decrypting_key) {
                cryptoState = <Progress />;
            } else {
                cryptoState = <LockIcon />;
            }
        } else {
            cryptoState = <LockIcon />;
        }

        return (
            <div class="header-status">
                {connState}
                <span class="status-padding" />
                <span class="status-crypto">
                    {cryptoState}
                </span>
            </div>
        );
    }));
}
