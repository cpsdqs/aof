import { loadSource, loadSourceItem } from "###MODULE###";

async function run() {
    const req = Deno.core.opSync('aof_get_request');
    let res;
    if (req.type === 'source') {
        console.info(`Loading source ${req.path}`);
        res = await loadSource(req.path);
    } else if (req.type === 'source-item') {
        console.info(`Loading source item ${req.path}`);
        res = await loadSourceItem(req.path);
    }
    console.info('Script executed successfully');
    if (typeof res !== 'object') throw new Error('Result is not an object; got ' + res);

    Deno.core.opSync('aof_set_response', res);
}

run().catch(err => {
    console.error(err);
});
