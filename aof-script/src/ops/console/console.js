// override print so it doesn’t print to stdout directly
Deno.core.print = (obj, isErr) => {
    if (isErr) console.error(obj);
    else console.log(obj);
};
