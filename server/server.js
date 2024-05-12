// Import required modules
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { createWorker } = require("mediasoup");

// Create Express app
const app = express();
app.use(cors());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173", // Allow access from this origin
        methods: ["GET", "POST"], // Allow only specified methods
        allowedHeaders: ["my-custom-header"],
        credentials: true, // Allow credentials (cookies, authorization headers, etc.)
    },
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
}).then((w) => {
    worker = w;
    return worker.on("died", (error) => {
        // This implies something serious happened, so kill the application
        console.error("mediasoup worker has died");
        setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
    });
});

// mediasoup codecs
const mediaCodecs = [
    {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
    },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {
            "x-google-start-bitrate": 1000,
        },
    },
];

io.on("connection", async (socket) => {
    console.log("A user connected");
    router = await worker.createRouter({ mediaCodecs });

    socket.on("disconnect", () => {
        console.log("User disconnected");
    });
    socket.on("rtp-cap", async (cb) => {
        const rtp = router.rtpCapabilities;
        cb(rtp);
    });

    socket.on("create-transport", async ({ producer }, cb) => {
        if (producer) {
            producerTransport = await createWebRtcTransport(cb);
        } else {
            consumerTransport = await createWebRtcTransport(cb);
        }
    });

    socket.on("transport-connect", async ({ dtlsParameters }) => {
        await producerTransport.connect({ dtlsParameters });
    });

    socket.on(
        "transport-produce",
        async ({ kind, rtpParameters }, callback) => {
            producer = await producerTransport.produce({
                kind,
                rtpParameters,
            });

            producer.on("transportclose", () => {
                producer.close();
            });

            // Send back to the client the Producer's id
            callback({
                id: producer.id,
            });
            return producer
        },
    );
    socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
        await consumerTransport.connect({ dtlsParameters });
    });
    socket.on("consume", async ({ rtpCapabilities }, callback) => {
        try {
            // check if the router can consume the specified producer
            console.log(producer)
            if (
                router.canConsume({
                    producerId: producer.id,
                    rtpCapabilities,
                })
            ) {
                // transport can now consume and return a consumer
                consumer = await consumerTransport.consume({
                    producerId: producer.id,
                    rtpCapabilities,
                    paused: true,
                });

                consumer.on("transportclose", () => {
                    console.log("transport close from consumer");
                });

                consumer.on("producerclose", () => {
                    console.log("producer of consumer closed");
                });

                const params = {
                    id: consumer.id,
                    producerId: producer.id,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                };

                callback({ params });
            }
        } catch (error) {
            console.log(error);
            callback({
                params: {
                    error: error,
                },
            });
        }
    });

    socket.on("consumer-resume", async () => {
        console.log("consumer resume");
        await consumer.resume();
    });
});

const createWebRtcTransport = async (callback) => {
    try {
        const webRtcTransport_options = {
            listenIps: [
                {
                    ip: "127.0.0.1", // replace with relevant IP address
                },
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        };

        let transport = await router.createWebRtcTransport(
            webRtcTransport_options,
        );
        console.log(`transport id: ${transport.id}`);

        transport.on("dtlsstatechange", (dtlsState) => {
            if (dtlsState === "closed") {
                transport.close();
            }
        });

        transport.on("close", () => {
            console.log("transport closed");
        });

        // send back to the client the following prameters
        callback({
            // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            },
        });

        return transport;
    } catch (error) {
        console.log(error);
        callback({
            params: {
                error: error,
            },
        });
    }
};
