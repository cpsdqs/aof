import { h } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import { Checkbox, TaskButton, TextField } from 'uikit';
import { load, LOGIN_LOGIN } from './data';
import standalone from './standalone';
import LocalePicker from './components/locale-picker';
import get from './locale';
import './login.less';

export default class Login extends PureComponent {
    state = {
        name: '',
        password: '',
        persist: false,
    };

    login = async () => {
        await load(LOGIN_LOGIN, {
            name: this.state.name,
            password: this.state.password,
            persist: this.state.persist,
        });
    };

    componentDidMount() {
        this.nameInput.current.focus();
    }

    nameInput = createRef();
    passwordInput = createRef();
    submitButton = createRef();

    render() {
        return (
            <div class="app-login">
                <form
                    class="app-login-dialog"
                    onSubmit={e => {
                        e.preventDefault();
                        this.submitButton.current.run();
                    }}>
                    <div class="login-title">{get('login.title')}</div>
                    <div class="login-field">
                        <label class="login-field-label">{get('login.name')}</label>
                        <TextField
                            autocomplete="on"
                            ref={this.nameInput}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (this.state.password) {
                                        // password already (auto?)filled; submit
                                        this.submitButton.current.run();
                                    } else {
                                        this.passwordInput.current.focus();
                                    }
                                }
                            }}
                            value={this.state.name}
                            onChange={name => this.setState({ name })} />
                    </div>
                    <div class="login-field">
                        <label class="login-field-label">{get('login.password')}</label>
                        <TextField
                            autocomplete="on"
                            ref={this.passwordInput}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    this.submitButton.current.run();
                                }
                            }}
                            type="password"
                            value={this.state.password}
                            onChange={password => this.setState({ password })} />
                    </div>
                    <div class="login-field login-persist">
                        <Checkbox
                            class="persist-checkbox"
                            checked={this.state.persist}
                            onChange={persist => this.setState({ persist })}
                            id="login-persist" />
                        <label class="login-field-label" for="login-persist">
                            {get('login.persist')}
                        </label>
                    </div>
                    <div class="login-footer">
                        {standalone ? (
                            <span />
                        ) : (
                            <a class="login-cancel" href="..">{get('login.cancel')}</a>
                        )}
                        <TaskButton
                            ref={this.submitButton}
                            run={this.login}>
                            {get('login.login')}
                        </TaskButton>
                    </div>
                </form>
                <div class="login-etc">
                    <LocalePicker />
                </div>
            </div>
        )
    }
}
