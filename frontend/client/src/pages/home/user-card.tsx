import { h } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import { TaskButton } from 'uikit';
import {
    connect, load, LOGIN, LOGIN_LOGOUT, CONNECTION_STATE, CONNECTION_OPEN, CONNECTION_CLOSE,
} from '../../data';
import get from '../../locale';
import './user-card.less';
import { ConnectionIcon } from '../../components/icons';

export default class UserCard extends PureComponent {
    logoutButton = createRef();
    logOut = async () => {
        this.logoutButton.current.showAction(get('login.logout'), () => load(LOGIN_LOGOUT));
    };

    render() {
        return connect(LOGIN, view => {
            const login = view.get();

            return (
                <div class="home-user-card">
                    <div class="user-header">
                        <div class="user-name">{login}</div>
                        <TaskButton ref={this.logoutButton} class="logout-button" run={this.logOut}>
                            {get('login.logout')}
                        </TaskButton>
                    </div>
                    <Connection />
                </div>
            );
        });
    }
}

function Connection() {
    return connect(CONNECTION_STATE, view => {
        const state = view.get();

        let stateLabel = get('connection.state.closed');
        if (state === 'open') stateLabel = get('connection.state.open');
        else if (state === 'opening') stateLabel = get('connection.state.opening');
        else if (state === 'closing') stateLabel = get('connection.state.closing');

        let actionLabel = get('connection.action.open');
        const actionLoading = state === 'opening' || state === 'closing';
        let action = () => load(CONNECTION_OPEN);
        if (state === 'open' || state === 'closing') {
            actionLabel = get('connection.action.close');
            action = () => load(CONNECTION_CLOSE);
        }

        return (
            <div class="user-connection">
                <span class="connection-state">
                    <ConnectionIcon state={state} />
                    {' '}
                    {stateLabel}
                </span>
                <TaskButton class="connection-button" run={action} loading={actionLoading}>
                    {actionLabel}
                </TaskButton>
            </div>
        );
    });
}
