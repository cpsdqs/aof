import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { PageProps } from '../../router';
import DomainList from '../../components/domain-list';
import { DOMAINS_LIST_USER, DOMAINS_LIST_PUBLIC, load, DOMAIN_CREATE } from '../../data';
import { Switch, TaskButton, TextField } from 'uikit';
import get from '../../locale';
import './index.less';
import Dialog from '../../components/dialog';
import { Form, FormItem } from '../../components/form';
import { RefreshIcon, AddIcon } from '../../components/icons';
import SearchBox from '../../components/search-box';

export default class DomainsPage extends PureComponent<PageProps> {
    state = {
        tab: 'user',
        createOpen: false,
        query: '',
    };

    render({ route }: PageProps) {
        let contents;
        if (this.state.tab === 'user') {
            contents = (
                <DomainList
                    key="user"
                    list={DOMAINS_LIST_USER}
                    emptyMessage={get('domains.list.empty_user')}
                    selected={route.domain ? route.domain.id : null}
                    onSelect={id => {
                        this.context.navigate(`domains/${id}`);
                    }}/>
            );
        } else if (this.state.tab === 'public') {
            contents = (
                <DomainList
                    key="public"
                    list={DOMAINS_LIST_PUBLIC}
                    emptyMessage={get('domains.list.empty_public')}
                    selected={route.domain ? route.domain.id : null}
                    onSelect={id => {
                        this.context.navigate(`domains/${id}`);
                    }}/>
            );
        }

        return (
            <div class="domains-page">
                <div class="domains-page-header">
                    <Switch
                        value={this.state.tab}
                        onChange={tab => this.setState({ tab })}
                        options={[
                            {
                                value: 'user',
                                label: get('pages.domains.tabs.user'),
                            },
                            {
                                value: 'public',
                                label: get('pages.domains.tabs.public'),
                            },
                        ]} />
                    <div class="header-group">
                        <TaskButton run={async () => {
                            this.setState({ createOpen: true });
                        }}>
                            <AddIcon />
                        </TaskButton>
                        {' '}
                        <TaskButton run={async () => {
                            if (this.state.tab === 'user') {
                                await load(DOMAINS_LIST_USER);
                            } else if (this.state.tab === 'public') {
                                await load(DOMAINS_LIST_PUBLIC);
                            }
                        }}>
                            <RefreshIcon />
                        </TaskButton>
                    </div>
                </div>
                {/* <SearchBox
                    query={this.state.query}
                    onQueryChange={query => this.setState({ query })} /> */}
                {contents}

                <CreateDialog
                    open={this.state.createOpen}
                    onNavigate={p => this.context.navigate(p)}
                    onClose={() => this.setState({ createOpen: false })} />
            </div>
        )
    }
}

interface CreateDialogProps {
    open: boolean,
    onClose: () => void,
    onNavigate: (p: string) => void,
}
class CreateDialog extends PureComponent<CreateDialogProps> {
    state = {
        abbrev: '',
        name: '',
    }

    render() {
        return (
            <Dialog
                title={get('pages.domain.create.title')}
                open={this.props.open}
                onClose={this.props.onClose}
                // FIXME: this is hacky
                onUnmount={() => this.setState({ abbrev: '', name: '' })}
                destroy={<TaskButton run={async () => {
                    this.props.onClose();
                }}>
                    {get('pages.domain.create.cancel')}
                </TaskButton>}
                confirm={<TaskButton run={async () => {
                    const id = await load(DOMAIN_CREATE, {
                        abbrev: this.state.abbrev,
                        name: this.state.name,
                    });
                    this.props.onNavigate(`domains/${id}`);
                    this.props.onClose();
                }}>
                    {get('pages.domain.create.confirm')}
                </TaskButton>}>
                <Form>
                    <FormItem stack label={get('pages.domain.fields.abbrev')}>
                        <TextField
                            value={this.state.abbrev}
                            onChange={abbrev => this.setState({ abbrev })} />
                    </FormItem>
                    <FormItem stack label={get('pages.domain.fields.name')}>
                        <TextField
                            value={this.state.name}
                            onChange={name => this.setState({ name })} />
                    </FormItem>
                </Form>
            </Dialog>
        );
    }
}
