/* eslint-env worker */

let jobsActive = 0;
const complete = [];
const MAX_MYSQLADMIN_STATUS = 200;
let intervalId = null;

/**
 * A Fetch method that limits the maximum number of concurrent requests
 */
const _fetch = (function () {
    const queue = [];
    let pendingCount = 0;

    return async function (...args) {
        if (pendingCount >= MAX_MYSQLADMIN_STATUS) {
            return new Promise((resolve, reject) => {
                queue.push({args, resolve, reject});
            });
        }
        pendingCount++;
        const res = await fetch(...args);

        pendingCount--;
        if (queue.length) {
            const {args: _args, resolve, reject} = queue.shift();
            _fetch(..._args).then(resolve, reject);
        }
        return res;
    };
}());

/**
 * Register a step function.
 *
 * Step checks if there are completed jobs and if there are sends them to the
 * parent. Then it checks the jobs count. If there are no further jobs, clear
 * the step.
 */
const registerStep = function () {
    intervalId = setInterval(() => {
        if (complete.length) {
            // Send our chunk of completed requests and instruct postMessage to
            // transfer the buffers instead of copying them.
            postMessage(
                complete.slice(),
                // Instruct postMessage that these buffers in the sent message
                // should use their Transferable trait. After the postMessage
                // call the "buffers" will still be in complete if you looked,
                // but they will all be length 0 as the data they reference has
                // been sent to the window. This lets us send a lot of data
                // without the normal postMessage behaviour of making a copy of
                // all of the data for the window.
                complete.map(response => response.buffer).filter(Boolean)
            );
            complete.length = 0;
        }
        if (jobsActive === 0) {
            clearInterval(intervalId);
            intervalId = null;
        }
    }, 1);
};

/**
 * Receive a job from the parent and fetch the requested data.
 * @param {object} options.job A job id, url, and options descriptor to perform.
 */
const onMessage = ({data: job}) => {
    if (jobsActive === 0 && !intervalId) {
        registerStep();
    }

    jobsActive++;

    _fetch(job.url, job.options)
        .then(response => {
            if (response.status === 404) {
                throw new Error('404 Not found');
            }
            return response.arrayBuffer();
        })
        .then(buffer => complete.push({id: job.id, buffer}))
        .catch(error => complete.push({id: job.id, error}))
        .then(() => jobsActive--);
};

if (self.fetch) {
    postMessage({support: {fetch: true}});
    self.addEventListener('message', onMessage);
} else {
    postMessage({support: {fetch: false}});
    self.addEventListener('message', ({data: job}) => {
        postMessage([{id: job.id, error: new Error('fetch is unavailable')}]);
    });
}
