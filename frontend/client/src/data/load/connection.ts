import { getConn, close } from '../socket';

export default {
    open: async () => {
        await getConn();
    },
    close: async () => {
        await close();
    },
};
