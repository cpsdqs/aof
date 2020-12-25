import { cache } from '../cache';
import * as paths from '../paths';
import { DomainId, IDomain, IResult, join } from '../paths';
import { req } from '../socket';
import get from '../../locale';

export default {
    list_user: async () => {
        const res = await req<DomainId[]>('user_domains', null);
        cache.insert(paths.DOMAINS_LIST_USER, res);
        return res;
    },
    list_public: async () => {
        const res = await req<DomainId[]>('public_domains', null);
        cache.insert(paths.DOMAINS_LIST_PUBLIC, res);
        return res;
    },
    domain: async (_, id) => {
        const res = await req<IDomain | null>('domain', { id });
        if (res === null) throw new Error(get('data.domains.not_found'));
        cache.insert(join(paths.DOMAIN, id), res);
        return res;
    },
    domain_script: async (_, id) => {
        const res = await req<{
            success: boolean,
            script: string,
            error: string,
        }>('domain_script', { id });
        if (res.success) {
            cache.insert(join(paths.DOMAIN_SCRIPT, id), res.script);
            return res.script;
        } else {
            throw new Error(get(`data.domains.${res.error}`));
        }
    },
    create: async ({ abbrev, name }) => {
        const res = await req<{
            success: boolean,
            id: DomainId,
            error: string,
        }>('user_create_domain', { abbrev, name });

        if (!res.success) {
            throw new Error(get(`data.domains.${res.error}`));
        }

        // TODO: delete when events impl
        cache.delete(paths.DOMAINS_LIST_USER);

        return res.id;
    },
    update: async ({
            id, abbrev, name, description, is_public,
            script,
    }) => {
        const res = await req<IResult>('user_update_domain', {
            id, abbrev, name, description, is_public, script,
        });

        if (!res.success) {
            throw new Error(get(`data.domains.${res.error}`));
        }

        cache.insert(join(paths.DOMAIN, id), {
            abbrev,
            name,
            description,
            is_public,
            editable: true,
        });
        cache.insert(join(paths.DOMAIN_SCRIPT, id), script);

        // TODO: delete when events impl
        cache.delete(paths.DOMAINS_LIST_PUBLIC);
    },
    delete: async ({ id }) => {
        const res = await req<IResult>('user_delete_domain', { id });

        if (!res.success) {
            throw new Error(get(`data.domains.${res.error}`));
        }

        // TODO: delete when events impl
        cache.delete(join(paths.DOMAIN, id));
        cache.delete(join(paths.DOMAIN_SCRIPT, id));
        cache.delete(paths.DOMAINS_LIST_USER);
    },
    subscribe: async ({ id }) => {
        const res = await req<IResult>('user_subscribe_domain', { id });
        if (!res.success) {
            throw new Error(get(`data.domains.${res.error}`));
        }

        // TODO: delete when events impl
        cache.delete(paths.DOMAINS_LIST_USER);
    },
    unsubscribe: async ({ id }) => {
        const res = await req<IResult>('user_unsubscribe_domain', { id });
        if (!res.success) {
            throw new Error(get(`data.domains.${res.error}`));
        }

        // TODO: delete when events impl
        cache.delete(paths.DOMAINS_LIST_USER);
    },
} as paths.PDomainsType;
