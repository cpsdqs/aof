import libfp from '../../libfp/Cargo.toml';
import { expose } from 'comlink';

expose({
    generateSecretKey(password, callback) {
        libfp().then(fp => {
            const derived = fp.create_secret_key(password);
            callback(null, derived);
        }).catch(err => {
            callback(err.toString());
        });
    },
});

