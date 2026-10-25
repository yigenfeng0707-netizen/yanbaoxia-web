const express = require("express");
const path = require("path");
const paymentRouter = require("./routes/payment");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(paymentRouter);

// 同步回跳结果页（GET 路由，与 returnUrl 完全一致；无参数时展示中性状态）
app.get("/return", (_req, res) => res.sendFile(path.join(__dirname, "public", "return.html")));

// 商户侧订单查询页
app.get("/orders", (_req, res) => res.sendFile(path.join(__dirname, "public", "orders.html")));

app.listen(PORT, () => console.log(`yanbaoxia-web listening on ${PORT}`));
