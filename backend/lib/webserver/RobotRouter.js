const express = require("express");

// pkg cannot resolve named exports, so directly require the file.
// Look forward to replace pkg with Node SEA when it is ready.
try {
    require("valetudo-map-svg/dist/from-json.cjs");
} catch (e) {
    // Catch the exception, because this fails in runtime.
}

const vmsvg = require("valetudo-map-svg/from-json");

const ValetudoRobot = require("../core/ValetudoRobot");

const CapabilitiesRouter = require("./CapabilitiesRouter");
const {SSEHub, SSEMiddleware} = require("./middlewares/sse");

class RobotRouter {
    /**
     *
     * @param {object} options
     * @param {import("../core/ValetudoRobot")} options.robot
     * @param {*} options.validator
     */
    constructor(options) {
        this.robot = options.robot;
        this.router = express.Router({mergeParams: true});

        this.validator = options.validator;

        this.initRoutes();
        this.initSSE();
    }


    initRoutes() {
        this.router.get("/", (req, res) => {
            res.json({
                manufacturer: this.robot.getManufacturer(),
                modelName: this.robot.getModelName(),
                modelDetails: this.robot.getModelDetails(),
                implementation: this.robot.constructor.name
            });
        });

        this.router.get("/properties", (req, res) => {
            res.json(this.robot.getProperties());
        });

        this.router.get("/state", async (req, res) => {
            try {
                const polledState = await this.robot.pollState();

                res.json(polledState);
            } catch (err) {
                res.status(500).send(err.toString());
            }
        });

        this.router.get("/state/attributes", async (req, res) => {
            try {
                const polledState = await this.robot.pollState();

                res.json(polledState.attributes);
            } catch (err) {
                res.status(500).send(err.toString());
            }
        });

        this.router.get("/state/map", async (req, res) => {
            try {
                const polledState = await this.robot.pollState();

                res.json(polledState.map);
            } catch (err) {
                res.status(500).send(err.toString());
            }
        });

        this.router.get("/state/map.svg", async (req, res) => {
            try {
                const polledState = await this.robot.pollState();

                res.set('Content-Type', 'image/svg+xml');
                res.send(vmsvg.mapToSvg(polledState.map));
            } catch (err) {
                res.status(500).send(err.toString());
            }
        });

        this.router.get("/state/map.msvg", async (req, res) => {
            const boundary = ']]>?><%';
            function write(svg) {
                try {
                    res.write(`${svg}\r\n--${boundary}\r\nContent-Type: image/svg+xml\r\n\r\n`);
                } catch (err) {
                    this.svgConns.delete(write);
                }
            };
            this.svgConns ??= new Set();
            try {
                res.writeHead(200, {
                    'Transfer-Encoding': ``,
                    'Content-Type': `multipart/x-mixed-replace; boundary="${boundary}"`,
                });
                const polledState = await this.robot.pollState();
                res.write(`--${boundary}\r\nContent-Type: image/svg+xml\r\n\r\n`);
                write(vmsvg.mapToSvg(polledState.map));
                this.svgConns.add(write);
                res.on("close", () => {
                    this.svgConns.delete(write);
                });
            } catch (err) {
                res.close();
            }
        });

        this.router.use("/capabilities/", new CapabilitiesRouter({
            robot: this.robot,
            validator: this.validator
        }).getRouter());
    }

    initSSE() {
        this.sseHubs = {
            state: new SSEHub({name: "State"}),
            attributes: new SSEHub({name: "Attributes"}),
            map: new SSEHub({name: "Map"})
        };

        this.robot.onStateUpdated(() => {
            this.sseHubs.state.event(
                ValetudoRobot.EVENTS.StateUpdated,
                JSON.stringify(this.robot.state)
            );
        });

        this.robot.onStateAttributesUpdated(() => {
            this.sseHubs.attributes.event(
                ValetudoRobot.EVENTS.StateAttributesUpdated,
                JSON.stringify(this.robot.state.attributes)
            );
        });

        this.robot.onMapUpdated(() => {
            this.sseHubs.map.event(
                ValetudoRobot.EVENTS.MapUpdated,
                JSON.stringify(this.robot.state.map)
            );
        });

        this.robot.onMapUpdated(() => {
            this.svgConns ??= new Set();
            if (this.svgConns.size) {
                const svg = vmsvg.mapToSvg(this.robot.state.map);
                for (let lstnr of this.svgConns) lstnr(svg);
            }
        });

        this.router.get(
            "/state/sse",
            SSEMiddleware({
                hub: this.sseHubs.state,
                keepAliveInterval: 5000,
                maxClients: 5
            }),
            (req, res) => {
                //Intentional, as the response will be handled by the SSEMiddleware
            }
        );

        this.router.get(
            "/state/attributes/sse",
            SSEMiddleware({
                hub: this.sseHubs.attributes,
                keepAliveInterval: 5000,
                maxClients: 5
            }),
            (req, res) => {
                //Intentional, as the response will be handled by the SSEMiddleware
            }
        );

        this.router.get(
            "/state/map/sse",
            SSEMiddleware({
                hub: this.sseHubs.map,
                keepAliveInterval: 5000,
                maxClients: 5
            }),
            (req, res) => {
                //Intentional, as the response will be handled by the SSEMiddleware
            }
        );
    }

    getRouter() {
        return this.router;
    }

    shutdown() {
        Object.values(this.sseHubs).forEach(hub => {
            hub.shutdown();
        });
    }
}

module.exports = RobotRouter;
