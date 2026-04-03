const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory Management System API',
      version: '1.0.0',
      description: `
# Inventory Management System Backend API

This API provides endpoints for managing inventory, employees, assignments, and more.

## Features
- 🔐 Authentication & Authorization (JWT)
- 📦 Inventory Management
- 👥 Employee Management
- 📋 Assignment Tracking
- 📱 SIM Card Management
- 🏢 Branch & Team Management
- 📊 Transaction History
- 🔔 Notifications
- 📝 Audit Logs

## Security
All API endpoints (except login and setup) require a JWT token in the Authorization header:
\`\`\`
Authorization: Bearer <your_jwt_token>
\`\`\`
      `,
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:5000/api',
        description: 'Development server'
      },
      {
        url: 'https://api.example.com/api',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'manager', 'user'] },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        InventoryItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            brand: { type: 'string' },
            model: { type: 'string' },
            category_id: { type: 'string', format: 'uuid' },
            serial_number: { type: 'string' },
            quantity: { type: 'integer' },
            status: { 
              type: 'string', 
              enum: ['available', 'assigned', 'maintenance', 'retired'] 
            },
            deleted_at: { type: 'string', format: 'date-time', nullable: true }
          }
        },
        Employee: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            national_id: { type: 'string' },
            department: { type: 'string' },
            position: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string', format: 'email' },
            status: { 
              type: 'string', 
              enum: ['active', 'inactive', 'suspended'] 
            }
          }
        },
        Assignment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            employee_id: { type: 'string', format: 'uuid' },
            item_id: { type: 'string', format: 'uuid' },
            quantity: { type: 'integer' },
            status: { 
              type: 'string', 
              enum: ['active', 'returned', 'lost'] 
            },
            assignment_date: { type: 'string', format: 'date-time' },
            expected_return_date: { type: 'string', format: 'date' },
            return_date: { type: 'string', format: 'date-time', nullable: true }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  },
  apis: ['./src/routes/*.js'] // Path to the API route files
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs
};
