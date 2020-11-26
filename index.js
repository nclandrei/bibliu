const express = require('express');
const app = express();
const http = require('http').Server(app);
const bodyParser = require('body-parser');
const fs = require('fs');
const io = require('socket.io')(http);

const port = 8080;

const users = require('./users.json');
const products = require('./products.json');
const customers = require('./customers.json');
const orders = require('./orders.json');

app.use(express.static('static'))
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

let websocketListeners = new Map();

// I would have used this auth middleware, but it's impossible since
// the requests the browser sends do not include any request headers for either
// Basic: user:pass or Authorization: Bearer JWT_HERE. Therefore, I will just 
// explain my reasoning here: I would have stored the tokens in a tokens.json file
// then I would have checked request headers and see whether the user still has
// a valid token (expiration time let's say every 30 minutes). If the user is
// not in the tokens file or they are not valid to authenticate, I would just 
// redirect them to the homepage. Otherwise, I would call next, which would 
// get them to the page they wanted to visit.
// Also, you mentioned this in the challenge description:
// You can add files to your submission, but if you edit any of the provided files, other than those specified, your changes will be IGNORED.
//
// const authMiddleware = (req, res, next) => {
// };

const convertToShippingProducts = (orders) => {
  return orders.map(order => {
    const shippingAddress = customers.find(b => b.name === order.buyer);
    const timestamp = Date.parse(order.orderDate + " " + order.orderTime);

    return order.items.map(item => {
      const productID = products.find(p => p.name === item.item);
      return {
        buyer: order.buyer,
        productId: productID.productId,
        quantity: item.quantity,
        shippingAddress: shippingAddress.address,
        shippingTarget: timestamp,
      }
    });
  }).flat(1);
};

let shippingProducts;

try {
  if (fs.existsSync('./shippingProducts.json')) {
    shippingProducts = require('./shippingProducts.json');
  } else {
    shippingProducts = convertToShippingProducts(orders, customers, products);
    fs.writeFile('./shippingProducts.json', JSON.stringify(shippingProducts), (err) => {
      if (err) {
        console.error(err);
      }
    });
  }
} catch (err) {
  shippingProducts = convertToShippingProducts(orders, customers, products);
  fs.writeFile('./shippingProducts.json', JSON.stringify(shippingProducts), (err) => {
    if (err) {
      console.error(err);
    }
  });
}

app.post('/auth', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  const user = users.find(u => u.username === username);
  (user && user.password === password) ? res.redirect('/home.html') : res.redirect('login.html');
});

app.get('/show', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(shippingProducts));
});

// there is a bug in the upload.html static file you provided - sending the data
// as application/x-www-form-urlencoded is not the same as sending in JSON format,
// it uses a format not specified anywhere in the documentation.
app.post('/upload', (req, res) => {
  const newShippingProducts = convertToShippingProducts([req.body]);
  shippingProducts = shippingProducts.concat(newShippingProducts);

  fs.writeFile('./shippingProducts.json', JSON.stringify(shippingProducts), (err) => {
    if (err) {
      console.error(err);
    }
  });

  newShippingProducts.forEach(product => {
    const sockets = websocketListeners.get(product.productId);
    if (sockets) {
      sockets.forEach(socket => {
        socket.emit('order', JSON.stringify(product));
      })
    };
  });

  res.sendStatus(200);
});

app.get('/search', (req, res) => {
  const productId = req.query.productId;
  const buyer = req.query.buyer;
  const shippingTarget = req.query.shippingTarget;
  if (productId) {
    const productIdInt = parseInt(productId);
    res.end(JSON.stringify(shippingProducts.filter(sp => sp.productId === productIdInt)));
  } else if (buyer) {
    res.end(JSON.stringify(shippingProducts.filter(sp => sp.buyer === buyer)));
  } else if (shippingTarget) {
    const timestamp = parseInt(shippingTarget);
    res.end(JSON.stringify(shippingProducts.filter(sp => sp.shippingTarget >= timestamp)));
  }
});

io.on('connection', (socket) => {
  socket.on('subscribe', (productIDsStr) => {
    const productIDs = JSON.parse(productIDsStr);
    productIDs.forEach(id => {
      const sockets = websocketListeners.get(id);
      if (sockets) {
        websocketListeners.set(id, [socket, ...sockets]);
      } else {
        websocketListeners.set(id, [socket]);
      }
    });
  });
});

http.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`)
})

