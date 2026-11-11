import { buildApp } from './app';

const port = Number(process.env.PORT ?? 5180);

// Local only: the API binds to the loopback interface and nothing wider.
buildApp()
  .listen({ port, host: '127.0.0.1' })
  .then((address) => console.log(`api listening on ${address}`))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
