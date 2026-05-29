import dotenv from 'dotenv';
dotenv.config();

import { Server } from './network/server';

const PORT = parseInt(process.env.PORT || '8080', 10);

const server = new Server(PORT);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n收到退出信号，关闭服务器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n收到终止信号，关闭服务器...');
  process.exit(0);
});
