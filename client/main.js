import { io } from "socket.io-client";
import { Device } from "mediasoup-client";
let device;
let rtpCap;
let producerTransport;
let consumerTransport;
let producer;
let consumer;
let params = {
    // mediasoup params
    encodings: [
        {
            rid: "r0",
            maxBitrate: 100000,
            scalabilityMode: "S1T3",
        },
        {
            rid: "r1",
            maxBitrate: 300000,
            scalabilityMode: "S1T3",
        },
        {
            rid: "r2",
            maxBitrate: 900000,
            scalabilityMode: "S1T3",
        },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
        videoGoogleStartBitrate: 1000,
    },
};

const socket = io("http://localhost:3001");

const video2 = document.getElementById("video-2");
const video1 = document.getElementById("video-1");

// Select buttons by ID
const getLocalStreamButton = document.getElementById("get-local-stream");
const loadDeviceButton = document.getElementById("load-device");
const getRtpCapabilitiesButton = document.getElementById(
    "get-rtp-capabilities",
);
const createSendTransportButton = document.getElementById(
    "create-send-transport",
);
const produceFromSendTransportButton = document.getElementById(
    "produce-from-send-transport",
);
const createConsumeTransportButton = document.getElementById(
    "create-consume-transport",
);
const consumeFromConsumeTransportButton = document.getElementById(
    "consume-from-consume-transport",
);

// Add click event listeners to buttons
getLocalStreamButton.addEventListener("click", async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
        });
        video1.srcObject = stream;
        video1.play();
        params = {
            track:stream.getVideoTracks()[0],
            ...params,
        };
    } catch (error) {
        console.error("Error accessing local stream:", error);
    }
});

getRtpCapabilitiesButton.addEventListener("click", () => {
    socket.emit("rtp-cap", (rtpCapabilities) => {
        rtpCap = rtpCapabilities;
    });
});

loadDeviceButton.addEventListener("click", async () => {
    try {
        device = new Device();
        await device.load({ routerRtpCapabilities: rtpCap });
    } catch (e) {
        console.log(e);
    }
});

createSendTransportButton.addEventListener("click", async () => {
    await new Promise((res, rej) => {
        socket.emit("create-transport", { producer: true }, ({ params }) => {
            producerTransport = device.createSendTransport(params);
            res(producerTransport);
        });
    });
    producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
            try {
                socket.emit("transport-connect", {
                    dtlsParameters,
                });

                callback();
            } catch (error) {
                errback(error);
            }
        },
    );

    producerTransport.on("produce", async (parameters, callback, errback) => {
        try {
            console.log("emited produce event from here");
            socket.emit(
                "transport-produce",
                {
                    kind: parameters.kind,
                    rtpParameters: parameters.rtpParameters,
                    appData: parameters.appData,
                },
                ({ id }) => {
                    callback({ id });
                },
            );
        } catch (error) {
            errback(error);
        }
    });
});

produceFromSendTransportButton.addEventListener("click", async () => {
    producer = await producerTransport.produce(params);

    producer.on("trackended", () => {
        console.log("track ended");
    });

    producer.on("transportclose", () => {
        console.log("transport ended");
    });
});

createConsumeTransportButton.addEventListener("click", () => {
    socket.emit("create-transport", { producer: false }, ({ params }) => {
        consumerTransport = device.createRecvTransport(params);
        consumerTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
                try {
                    socket.emit("transport-recv-connect", {
                        dtlsParameters,
                    });

                    callback();
                } catch (error) {
                    errback(error);
                }
            },
        );
    });
});

consumeFromConsumeTransportButton.addEventListener("click", () => {
    socket.emit(
        "consume",
        {
            rtpCapabilities: device.rtpCapabilities,
        },
        async ({ params }) => {
            consumer = await consumerTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            });
            const { track } = consumer;
            video2.srcObject = new MediaStream([track]);
            video2.play()
            socket.emit("consumer-resume");
        },
    );
});
