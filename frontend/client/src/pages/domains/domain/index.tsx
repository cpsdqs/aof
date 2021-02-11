import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import { PageProps } from '../../../router';
import Domain from '../../../components/domain';
import DomainScript from '../../../components/domain-script';
import './index.less';
import {
    connect,
    connectf,
    DOMAIN,
    DOMAIN_SCRIPT,
    DOMAINS_LIST_USER,
    DOMAIN_UPDATE,
    join,
    load,
    lazyLoad, DOMAIN_DELETE, DOMAIN_SUBSCRIBE, DOMAIN_UNSUBSCRIBE
} from '../../../data';
import { Checkbox, Progress, TaskButton, TextField } from 'uikit';
import get from '../../../locale';
import { Form, FormItem } from '../../../components/form';
import Dialog, { DialogContents } from '../../../components/dialog';
import ScriptEditor from '../../../components/script-editor';

export default class DomainPage extends PureComponent<PageProps> {
    state = {
        edit: null,
        deleteOpen: false,
    };

    render({ route }: PageProps) {
        return connectf(join(DOMAIN, route.domain.id), view => {
            const domain = view.get();
            const editable = domain && domain.editable;
            const editing = !!this.state.edit;

            if (editing) {
                return (
                    <div class="domain-page is-editing">
                        <div class="domain-page-actions">
                            <TaskButton run={async () => this.setState({ edit: null })}>
                                {get('pages.domain.edit_discard')}
                            </TaskButton>
                            <TaskButton run={async () => {
                                const edit = this.state.edit as any;
                                await load(DOMAIN_UPDATE, {
                                    id: route.domain.id,
                                    abbrev: edit.abbrev,
                                    name: edit.name,
                                    description: edit.description,
                                    is_public: edit.is_public,
                                    script: edit.script,
                                });
                                this.setState({ edit: null });
                            }}>
                                {get('pages.domain.edit_save')}
                            </TaskButton>
                        </div>

                        <DomainEditor
                            edit={this.state.edit}
                            onChange={edit => this.setState({ edit })} />
                    </div>
                );
            }

            const actions = (
                <div class="domain-page-actions">
                    {editable && (
                        <TaskButton run={async () => {
                            this.setState({
                                edit: {
                                    ...domain,
                                    script: await lazyLoad(join(DOMAIN_SCRIPT, route.domain.id)),
                                },
                            });
                        }}>
                            {get('pages.domain.edit')}
                        </TaskButton>
                    )}
                    {editable && (
                        <TaskButton run={async () => {
                            this.setState({ deleteOpen: true });
                        }}>
                            {get('pages.domain.delete.title')}
                        </TaskButton>
                    )}
                    {!editable && <AddDomainButton id={route.domain.id} />}
                </div>
            );

            return (
                <div class="domain-page">
                    {actions}
                    <Domain id={route.domain.id} large />
                    <DomainScript id={route.domain.id} />

                    <DeleteDialog
                        id={route.domain.id}
                        open={this.state.deleteOpen}
                        onNavigate={this.context.navigate}
                        onClose={() => this.setState({ deleteOpen: false })} />
                </div>
            );
        });
    }
}

function DeleteDialog({
    id, open, onClose, onNavigate,
}: { id: string, open: boolean, onClose: () => void, onNavigate: (p: string) => void }) {
    return (
        <Dialog
            open={open}
            onClose={onClose}
            destroy={<TaskButton run={async () => {
                onClose();
            }}>
                {get('pages.domain.delete.cancel')}
            </TaskButton>}
            confirm={<TaskButton run={async () => {
                await load(DOMAIN_DELETE, { id });
                onNavigate('domains');
                onClose();
            }}>
                {get('pages.domain.delete.confirm')}
            </TaskButton>}>
            <DialogContents>
                {get('pages.domain.delete.description')}
            </DialogContents>
        </Dialog>
    );
}

function AddDomainButton({ id }: { id: string }) {
    return connect(DOMAINS_LIST_USER, view => {
        const list = view.get();
        let run = async () => {};
        let contents: any = <Progress />;
        if (list) {
            if (list.includes(id)) {
                run = async () => {
                    await load(DOMAIN_UNSUBSCRIBE, { id });
                };
                contents = get('pages.domain.unsubscribe');
            } else {
                run = async () => {
                    await load(DOMAIN_SUBSCRIBE, { id });
                };
                contents = get('pages.domain.subscribe');
            }
        }

        return (
            <TaskButton run={run}>
                {contents}
            </TaskButton>
        );
    });
}

function DomainEditor({ edit, onChange }: { edit: any, onChange: (e: any) => void }) {
    return (
        <Form>
            <FormItem label={get('pages.domain.fields.abbrev')}>
                <TextField
                    value={edit.abbrev}
                    onChange={abbrev => onChange({ ...edit, abbrev })} />
            </FormItem>
            <FormItem label={get('pages.domain.fields.name')}>
                <TextField
                    value={edit.name}
                    onChange={name => onChange({ ...edit, name })} />
            </FormItem>
            <FormItem stack label={get('pages.domain.fields.description')}>
                <textarea
                    class="description-text-area"
                    value={edit.description || ''}
                    onChange={e => {
                        // @ts-ignore
                        onChange({ ...edit, description: e.target.value })
                    }} />
            </FormItem>
            <FormItem
                label={get('pages.domain.fields.is_public')}
                description={edit.is_public && get('pages.domain.fields.is_public_desc')}>
                <Checkbox
                    checked={edit.is_public}
                    onChange={is_public => onChange({ ...edit, is_public })} />
            </FormItem>
            <FormItem stack label={get('pages.domain.fields.script')}>
                <ScriptEditor
                    class="domain-script-editor"
                    value={edit.script || ''}
                    onChange={script => onChange({ ...edit, script })} />
            </FormItem>
        </Form>
    );
}
