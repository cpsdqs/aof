import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { TaskButton } from 'uikit';
import { parseRoute, Route } from './router';
import pages from './pages';
import Header from './components/header';
import PageStack from './components/page-stack';
import './session.less';
import ErrorDisplay from './components/error-display';
import get from './locale';

export default class Session extends PureComponent<Session.Props, Session.State> {
    state = {
        route: [],
        error: null as any,
    };

    currentHash = '';
    componentDidMount() {
        this.onHashChange();
        window.addEventListener('hashchange', this.onHashChange);
    }

    componentWillUnmount() {
        window.removeEventListener('hashchange', this.onHashChange);
    }

    componentDidCatch(error: any) {
        // @ts-ignore
        this.setState({ error });
        console.error(error);
    }

    onHashChange = () => {
        if (window.location.hash !== this.currentHash) {
            this.currentHash = window.location.hash;
            const loc = this.currentHash.substr(1); // without the # sign
            this.setState({ route: parseRoute(loc) });
        }
    };

    navigate = (path: string) => {
        window.location.hash = path;
        this.currentHash = window.location.hash;
        this.setState({ route: parseRoute(path) });
    };

    getChildContext() {
        return { navigate: this.navigate };
    }

    render({}, { route }: Session.State) {
        if (this.state.error) {
            return (
                <div class="app-session is-crashed">
                    <h1>{get('error.crash.title')}</h1>
                    <ErrorDisplay error={this.state.error} />
                    <div class="reload-button">
                        <TaskButton run={async () => window.location.reload()}>
                            {get('error.crash.reload')}
                        </TaskButton>
                    </div>
                </div>
            );
        }

        const routeKeys: { [k: string]: object } = {};
        for (const p of route) routeKeys[p.key] = p.value;

        const pageStack = [
            <pages.home key="home" route={routeKeys} />,
        ];

        for (const p of route) {
            const Page = pages[p.id] || pages.error;
            pageStack.push(
                <Page key={`${p.id}@${p.raw}`} route={routeKeys} />
            );
        }

        return (
            <div class="app-session">
                <Header route={route} navigate={this.navigate} />
                <PageStack>
                    {pageStack}
                </PageStack>
            </div>
        );
    }
}

namespace Session {
    export interface Props {}
    export interface State {
        route: Route,
    }
}
