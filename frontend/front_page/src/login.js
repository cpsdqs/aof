import { h, render, Component } from 'preact';
import { Progress, TaskButton } from 'uikit';
import { session, loginEvents, b } from './api';
import './login.less';

class LoginState extends Component {
    state = {
        auth: false,
        name: '',
        loading: false,
    };

    load = () => {
        this.setState({ loading: true });

        session().then(result => {
            this.setState({ loading: false });
            if (result.auth) {
                this.setState({ auth: true, name: result.name });
            } else {
                this.setState({ auth: false });
            }
        }).catch(error => {
            this.setState({ loading: false, auth: false });
        });
    };

    componentDidMount() {
        this.load();
        loginEvents.on('update', this.load);
    }
    componentWillUnmount() {
        loginEvents.removeListener('update', this.load);
    }

    render(_, { loading, auth, name }) {
        if (auth) {
            return (
                <a href={b('web')} class="dyn-login-state is-logged-in">
                    <span class="user-name">{name}</span>
                    <span class="open-label">Open</span>
                </a>
            );
        } else if (loading) {
            return (
                <span class="dyn-login-state">
                    <Progress />
                    {' '}
                    <a href={b('web')}>Open</a>
                </span>
            );
        } else {
            return (
                <a href={b('web')}>Login</a>
            );
        }
    }
}

function mount() {
    const loginState = document.querySelector('#login-state');
    if (!loginState) {
        setTimeout(mount, 100);
        return;
    }
    loginState.innerHTML = '';
    render(<LoginState />, loginState);
}
mount();
