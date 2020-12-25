import { h, render } from 'preact';
import { createRef, PureComponent } from 'preact/compat';
import { TaskButton } from 'uikit';
import RegistrationDialog from './dialog';
import './index.less';
import { isTokenValid } from '../api';

class Registration extends PureComponent {
    state = {
        token: '',
        submitting: false,
        registering: false,
    };

    submitToken = async () => {
        this.setState({ submitting: true, registering: false });
        const { token } = this.state;

        try {
            if (await isTokenValid(this.state.token)) {
                this.setState({ registering: true }, () => {
                    this.tokenInput.current.blur();
                });
            } else {
                throw new Error('Code is not valid');
            }
        } catch (err) {
            throw err;
        } finally {
            this.setState({ submitting: false });
        }
    };

    onSuccess = () => {
        this.setState({ token: '', registering: false });
    };

    tokenInput = createRef();
    submitButton = createRef();

    render() {
        return (
            <div class="registration-container">
                <div class="registration-title">Registration</div>
                <div class="token-input-container">
                    <input
                        ref={this.tokenInput}
                        class="token-input"
                        disabled={this.state.submitting}
                        value={this.state.token}
                        placeholder="Invite code"
                        onChange={e => {
                            this.setState({ token: e.target.value });
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && this.state.token) {
                                this.submitButton.current.run();
                            }
                        }}
                        type="text"
                        name="registration_token"
                        autocomplete="off" />
                </div>
                <div
                    class={'button-container' + (!this.state.token ? ' is-hidden' : '')}>
                    <TaskButton
                        ref={this.submitButton}
                        disabled={!this.state.token}
                        run={this.submitToken}
                        class="registration-button">
                        Register
                    </TaskButton>
                </div>

                <RegistrationDialog
                    onSuccess={this.onSuccess}
                    open={this.state.registering}
                    onClose={() => this.setState({ registering: false })}
                    token={this.state.token} />
            </div>
        );
    }
}

function mount() {
    const node = document.querySelector('#registration');
    if (!node) {
        setTimeout(mount, 100);
        return;
    }

    render(<Registration />, node);
}
mount();
