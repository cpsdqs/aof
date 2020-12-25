import { h, render } from 'preact';
import { PureComponent } from 'preact/compat';
import { Progress } from 'uikit';
import Login from './login';
import standalone from './standalone';
import Session from './session';
import { connect, LOGIN } from './data';
import { localeUpdate } from './locale';
import 'uikit';
import './index.less';

if (standalone && (window.navigator.userAgent.includes('iPhone')
    || window.navigator.userAgent.includes('iPad')
    // iPads pretend they're macs now but macOS doesn't use navigator.standalone so this is fine
    || window.navigator.userAgent.includes('Macintosh'))) {
    document.body.classList.add('is-ios-standalone');
}

const jsLoadError = document.querySelector('#js-load-error');
if (jsLoadError) jsLoadError.remove();

class App extends PureComponent {
    state = {
        renderNothing: false,
    };

    componentDidMount() {
        localeUpdate.on('update', this.onLocaleUpdate);
    }
    componentWillUnmount() {
        localeUpdate.removeListener('update', this.onLocaleUpdate);
    }

    onLocaleUpdate = () => {
        // delete and re-create the whole thing
        this.setState({
            renderNothing: true
        }, () => {
            this.setState({
                renderNothing: false,
            });
        });
    };

    render() {
        if (this.state.renderNothing) return null;

        return connect(LOGIN, view => {
            const login = view.get();
            let contents = (
                <div class="app-loading">
                    <Progress block />
                </div>
            );
            if (login) {
                contents = (
                    <Session />
                );
            } else if (login === '') {
                contents = (
                    <Login />
                )
            }

            return (
                <div class="app">
                    {contents}
                </div>
            );
        });
    }
}

const root = document.createElement('div');
root.id = 'app-root';
document.body.appendChild(root);
render(<App />, root);
