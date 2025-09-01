import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';

import helmet from 'helmet';

import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import createError from 'http-errors';
import pino from 'pino';
import pinoHttp from 'pino-http';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import asyncHandler from 'express-async-handler';

// Initialize Express app
const app = express();

// Get current directory in ES modules


// Configure logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

// HTTP request logger middleware
app.use(pinoHttp({ logger }));

// Validate required environment variables
const requiredEnvVars = ['OLLAMA_ENDPOINTS'];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  logger.error(
    `Missing required environment variables: ${missingVars.join(', ')}`,
  );
  process.exit(1);
}

// Security headers
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ['\'self\''],
      scriptSrc: ['\'self\''],
      styleSrc: ['\'self\''],
      imgSrc: ['\'self\''],
      connectSrc: ['\'self\''],
      fontSrc: ['\'self\''],
      objectSrc: ['\'none\''],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: 'same-site' },
  dnsPrefetchControl: true,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: { maxAge: 15552000, includeSubDomains: true },
  ieNoOpen: true,
  noSniff: true,
  xssFilter: true,
};

// Apply security middleware
app.use(helmet(helmetConfig));

// Configure CORS
const corsOptions = {
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    : '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes by default
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10), // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Trust first proxy if behind a reverse proxy (e.g., Nginx)
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Force HTTPS in production
if (
  process.env.NODE_ENV === 'production' &&
  process.env.FORCE_HTTPS === 'true'
) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ollama Model Manager API',
      version: '1.0.0',
      description: 'API for managing Ollama models',
      contact: {
        name: 'KhulnaSoft Lab',
        url: 'https://github.com/khulnasoft-lab/ollama-model',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          name: 'x-api-key',
          in: 'header',
        },
      },
    },
  },
  apis: ['./server.js'],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

// API Key Middleware
const apiKeyAuth = (req, res, next) => {
  if (process.env.API_KEY) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.API_KEY) {
      return next(createError(401, 'Invalid API key'));
    }
  }
  next();
};

// Apply API key authentication to all API routes
app.use('/api', apiKeyAuth);

// Serve Swagger UI
if (process.env.ENABLE_SWAGGER !== 'false') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Serve static files
app.use(
  express.static('public', {
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : '0',
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'public, max-age=0');
      }
    },
  }),
);

// Health check endpoint
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Store the Ollama endpoint
let ollamaEndpoint = 'http://localhost:11434';

// Get endpoints from environment variable
const getEndpoints = () => {
  const endpoints = process.env.OLLAMA_ENDPOINTS || 'http://localhost:11434';
  return endpoints.split(',').map((endpoint) => ({
    url: endpoint.trim(),
    active: endpoint.trim() === ollamaEndpoint,
  }));
};

/**
 * @swagger
 * /api/endpoints:
 *   get:
 *     summary: Get available Ollama endpoints
 *     tags: [Endpoints]
 *     responses:
 *       200:
 *         description: List of available endpoints
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   url:
 *                     type: string
 *                     example: http://localhost:11434
 *                   active:
 *                     type: boolean
 *                     example: true
 */
app.get('/api/endpoints', (req, res) => {
  res.json(getEndpoints());
});

/**
 * @swagger
 * /api/set-endpoint:
 *   post:
 *     summary: Set the active Ollama endpoint
 *     tags: [Endpoints]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - endpoint
 *             properties:
 *               endpoint:
 *                 type: string
 *                 example: http://localhost:11434
 *     responses:
 *       200:
 *         description: Endpoint set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Endpoint set successfully
 *       400:
 *         description: Invalid endpoint
 */
app.post(
  '/api/set-endpoint',
  [body('endpoint').isURL().withMessage('Valid URL is required')],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createError(400, { errors: errors.array() });
    }

    const { endpoint } = req.body;

    try {
      // Test the endpoint
      await axios.get(`${endpoint}/api/tags`, { timeout: 5000 });
      ollamaEndpoint = endpoint;
      logger.info(`Ollama endpoint set to: ${endpoint}`);

      res.json({
        success: true,
        message: 'Endpoint set successfully',
        endpoint: ollamaEndpoint,
      });
    } catch (error) {
      logger.error(`Failed to connect to Ollama endpoint ${endpoint}:`, error);
      throw createError(400, `Failed to connect to endpoint: ${error.message}`);
    }
  }),
);

// Centralized error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  // Log the error
  logger.error({
    status,
    message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
  });

  // Set response status and send error
  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res, next) => {
  next(createError(404, `Not Found - ${req.originalUrl}`));
});

/**
 * @swagger
 * /api/models:
 *   get:
 *     summary: Get all available models
 *     tags: [Models]
 *     responses:
 *       200:
 *         description: List of available models
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Model'
 */
app.get(
  '/api/models',
  asyncHandler(async (req, res) => {
    try {
      const response = await axios.get(`${ollamaEndpoint}/api/tags`);

      // Get details for each model
      const modelsWithDetails = await Promise.all(
        response.data.models.map(async (model) => {
          try {
            const detailsResponse = await axios.post(
              `${ollamaEndpoint}/api/show`,
              { name: model.name },
              { timeout: 10000 },
            );

            return {
              ...model,
              details: {
                parent_model: detailsResponse.data.details?.parent_model || '',
                format: detailsResponse.data.details?.format || '',
                family: detailsResponse.data.details?.family || '',
                families: detailsResponse.data.details?.families || [],
                parameter_size:
                  detailsResponse.data.details?.parameter_size || '',
                quantization_level:
                  detailsResponse.data.details?.quantization_level || '',
              },
            };
          } catch (error) {
            logger.warn(
              `Failed to get details for model ${model.name}:`,
              error,
            );
            return model; // Return basic model info if details fetch fails
          }
        }),
      );

      // Sort models alphabetically
      const sortedModels = modelsWithDetails.sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      res.json(sortedModels);
    } catch (error) {
      logger.error('Failed to fetch models:', error);
      throw createError(500, 'Failed to fetch models', {
        originalError: error.message,
      });
    }
  }),
);

/**
 * @swagger
 * /api/models:
 *   delete:
 *     summary: Delete one or more models
 *     tags: [Models]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - models
 *             properties:
 *               models:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["llama2:latest", "mistral:7b"]
 *     responses:
 *       200:
 *         description: Models deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Models deleted successfully"
 *       400:
 *         description: Invalid request or failed to delete some models
 */
app.delete(
  '/api/models',
  [
    body('models').isArray().withMessage('Models must be an array'),
    body('models.*').isString().withMessage('Each model must be a string'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createError(400, { errors: errors.array() });
    }

    const { models } = req.body;
    if (!models || !Array.isArray(models) || models.length === 0) {
      throw createError(400, 'No models specified for deletion');
    }

    const results = await Promise.allSettled(
      models.map((model) =>
        axios.delete(`${ollamaEndpoint}/api/delete`, {
          data: { name: model },
          timeout: 30000,
        }),
      ),
    );

    const failed = results
      .map((result, index) => ({
        model: models[index],
        error: result.status === 'rejected' ? result.reason.message : null,
      }))
      .filter((item) => item.error);

    if (failed.length > 0) {
      logger.warn(`Failed to delete some models: ${JSON.stringify(failed)}`);
      throw createError(207, {
        success: true,
        message: 'Some models could not be deleted',
        failed,
        deleted: models.length - failed.length,
      });
    }

    res.json({
      success: true,
      message: 'Models deleted successfully',
      count: models.length,
    });
  }),
);

/**
 * @swagger
 * /api/pull:
 *   post:
 *     summary: Pull a model from Ollama Hub
 *     tags: [Models]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *             properties:
 *               model:
 *                 type: string
 *                 description: Name of the model to pull (e.g., "llama2:latest")
 *                 example: "llama2:latest"
 *     responses:
 *       200:
 *         description: Model pull started successfully
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 */
app.post(
  '/api/pull',
  [
    body('model')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Model name is required'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createError(400, { errors: errors.array() });
    }

    const { model } = req.body;
    logger.info(`Pulling model: ${model}`);

    // Set headers for streaming response
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const response = await axios({
        method: 'POST',
        url: `${ollamaEndpoint}/api/pull`,
        data: { name: model },
        responseType: 'stream',
        timeout: 0, // No timeout for long-running operations
      });

      // Stream the response from Ollama to the client
      response.data.pipe(res);

      // Handle stream errors
      response.data.on('error', (error) => {
        logger.error(`Error streaming model pull for ${model}:`, error);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Error during model pull',
            details: error.message,
          });
        }
      });

      // Handle stream end
      response.data.on('end', () => {
        logger.info(`Successfully pulled model: ${model}`);
        if (!res.headersSent) {
          res.end(JSON.stringify({ status: 'success', model }));
        }
      });
    } catch (error) {
      logger.error(`Failed to pull model ${model}:`, error);
      throw createError(500, `Failed to pull model: ${error.message}`);
    }
  }),
);

/**
 * @swagger
 * /api/ps:
 *   get:
 *     summary: Get running models
 *     tags: [Models]
 *     responses:
 *       200:
 *         description: List of running models
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 models:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/RunningModel'
 */
app.get(
  '/api/ps',
  asyncHandler(async (req, res) => {
    try {
      const response = await axios.get(`${ollamaEndpoint}/api/ps`, {
        timeout: 10000,
      });
      res.json(response.data);
    } catch (error) {
      logger.error('Failed to fetch running models:', error);
      throw createError(500, 'Failed to fetch running models', {
        originalError: error.message,
      });
    }
  }),
);

/**
 * @swagger
 * components:
 *   schemas:
 *     Model:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           example: "llama2:latest"
 *         size:
 *           type: number
 *           format: int64
 *           example: 3822629608
 *         digest:
 *           type: string
 *           example: "sha256:9f6c1b241b4cb046c36cafcdf3d7a0c0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"
 *         details:
 *           type: object
 *           properties:
 *             parent_model:
 *               type: string
 *               example: ""
 *             format:
 *               type: string
 *               example: "gguf"
 *             family:
 *               type: string
 *               example: "llama"
 *             families:
 *               type: array
 *               items:
 *                 type: string
 *             parameter_size:
 *               type: string
 *               example: "7B"
 *             quantization_level:
 *               type: string
 *               example: "Q4_0"
 *
 *     RunningModel:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           example: "llama2:latest"
 *         model:
 *           type: string
 *           example: "llama2"
 *         size:
 *           type: number
 *           example: 1234567890
 *         size_vram:
 *           type: number
 *           example: 1234567890
 *         size_pending:
 *           type: number
 *           example: 0
 *         size_vram_pending:
 *           type: number
 *           example: 0
 *         details:
 *           $ref: '#/components/schemas/ModelDetails'
 *
 *     ModelDetails:
 *       type: object
 *       properties:
 *         format:
 *           type: string
 *           example: "gguf"
 *         family:
 *           type: string
 *           example: "llama"
 *         families:
 *           type: array
 *           items:
 *             type: string
 *         parameter_size:
 *           type: string
 *           example: "7B"
 *         quantization_level:
 *           type: string
 *           example: "Q4_0"
 */

// Start the server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  const address = server.address();
  const host = address.address === '::' ? 'localhost' : address.address;
  const port = address.port;

  console.log(`Server running at http://${host}:${port}`);
  logger.info(`Server running at http://${host}:${port}`);

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `API Documentation available at http://${host}:${port}/api-docs`,
    );
    logger.info(
      `API Documentation available at http://${host}:${port}/api-docs`,
    );
  }

  // Log environment info
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(
    `Ollama endpoints: ${process.env.OLLAMA_ENDPOINTS || 'Not configured'}`,
  );
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Consider restarting the server or performing cleanup
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Perform cleanup if needed
  process.exit(1); // Exit with error
});

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);

  // Close the server
  server.close((err) => {
    if (err) {
      logger.error('Error during server shutdown:', err);
      process.exit(1);
    }

    // Close database connections or other resources here
    logger.info('Server has been stopped');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Listen for shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Export the server for testing
if (process.env.NODE_ENV === 'test') {
  module.exports = { app, server };
}

// 404 handler - must be after all other routes but before error handlers
app.use((req, res, next) => {
  next(createError(404, `Not Found - ${req.originalUrl}`));
});

// Global error handler - must be the last middleware
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  // Don't log 404 errors as errors
  if (status === 404) {
    logger.info(`404 Not Found: ${req.method} ${req.originalUrl}`);
  } else {
    logger.error(`Error [${status}]: ${message}`, {
      path: req.path,
      method: req.method,
      ip: req.ip,
      error:
        process.env.NODE_ENV === 'production' ? undefined : err.stack || err,
    });
  }

  // Don't leak stack traces in production
  const errorResponse = {
    success: false,
    message,
    ...(process.env.NODE_ENV !== 'production' && {
      error: err.message,
      ...(err.stack && { stack: err.stack }),
    }),
  };

  // Additional error details for validation errors
  if (err.errors) {
    errorResponse.errors = err.errors;
  }

  res.status(status).json(errorResponse);
});

// Handle streaming response for model operations
const handleModelOperation = async (req, res, operation) => {
  try {
    const response = await axios({
      method: 'POST',
      url: `${ollamaEndpoint}/api/${operation.type || 'pull'}`,
      data: { name: operation.model },
      responseType: 'stream',
      timeout: 0, // No timeout for long-running operations
    });

    // Stream the response from Ollama to the client
    response.data.pipe(res);

    // Handle stream errors
    response.data.on('error', (error) => {
      logger.error(
        `Error streaming ${operation.type || 'operation'} for ${operation.model}:`,
        error,
      );
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: `Error during ${operation.type || 'operation'}`,
          details: error.message,
        });
      }
    });

    // Handle stream end
    response.data.on('end', () => {
      logger.info(
        `Successfully completed ${operation.type || 'operation'} for model: ${operation.model}`,
      );
      if (!res.headersSent) {
        res.end(
          JSON.stringify({
            status: 'success',
            model: operation.model,
            operation: operation.type || 'pull',
          }),
        );
      }
    });
  } catch (error) {
    logger.error(
      `Failed to ${operation.type || 'process operation'} for model ${operation.model}:`,
      error,
    );
    throw createError(
      500,
      `Failed to ${operation.type || 'process operation'}: ${error.message}`,
    );
  }
};

/**
 * @swagger
 * /api/update-model:
 *   post:
 *     summary: Update a model
 *     tags: [Models]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - modelName
 *             properties:
 *               modelName:
 *                 type: string
 *                 description: Name of the model to update
 *                 example: "llama2:latest"
 *     responses:
 *       200:
 *         description: Model update started successfully
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 */
app.post(
  '/api/update-model',
  [
    body('modelName')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Model name is required'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createError(400, { errors: errors.array() });
    }

    const { modelName } = req.body;
    await handleModelOperation(req, res, { model: modelName, type: 'update' });
  }),
);

// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/**
 * @swagger
 * /api/models:
 *   delete:
 *     summary: Delete one or more models
 *     tags: [Models]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - models
 *             properties:
 *               models:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["llama2:latest", "mistral:7b"]
 *     responses:
 *       200:
 *         description: Models deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Models deleted successfully"
 *                 count:
 *                   type: integer
 *                   example: 2
 *       207:
 *         description: Some models could not be deleted
 *       400:
 *         description: Invalid request or no models specified
 *       500:
 *         description: Failed to process delete request
 */
app.delete(
  '/api/models',
  [
    body('models').isArray().withMessage('Models must be an array'),
    body('models.*').isString().withMessage('Each model must be a string'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createError(400, { errors: errors.array() });
    }

    const { models } = req.body;
    if (!models || !Array.isArray(models) || models.length === 0) {
      throw createError(400, 'No models specified for deletion');
    }

    const results = await Promise.allSettled(
      models.map((model) =>
        axios.delete(`${ollamaEndpoint}/api/delete`, {
          data: { name: model },
          timeout: 30000,
        }),
      ),
    );

    const failed = results
      .map((result, index) => ({
        model: models[index],
        error: result.status === 'rejected' ? result.reason.message : null,
      }))
      .filter((item) => item.error);

    if (failed.length > 0) {
      if (failed.length === models.length) {
        // All deletions failed
        throw createError(500, {
          success: false,
          message: 'Failed to delete all models',
          failed,
        });
      }

      // Some deletions failed
      res.status(207).json({
        success: true,
        message: 'Some models could not be deleted',
        failed,
        deleted: models.length - failed.length,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Models deleted successfully',
      count: models.length,
    });
  }),
);

/**
 * @swagger
 * /api/pull:
 *   post:
 *     summary: Pull a model from Ollama Hub
 *     tags: [Models]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *             properties:
 *               model:
 *                 type: string
 *                 description: Name of the model to pull (e.g., "llama2:latest")
 *                 example: "llama2:latest"
 *     responses:
 *       200:
 *         description: Model pull started successfully
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 */
app.post(
  '/api/pull',
  [
    body('model')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Model name is required'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createError(400, { errors: errors.array() });
    }

    const { model } = req.body;
    await handleModelOperation(req, res, { model, type: 'pull' });
  }),
);
