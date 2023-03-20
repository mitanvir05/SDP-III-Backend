require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 5000;
const app = express();

// middleware
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Hello there!",
  });
});

const uri = `${process.env.DB_URI}`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// verifying JWT as middleware
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res
      .status(401)
      .send({ message: "Access to this route is not authorized yet" });
  }
  const token = authHeader?.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(403)
        .send({ message: "Access to this route is forbidden" });
    }
    req.decoded = decoded;
    // console.log('decoded ', decoded);
    // console.log('Auth header ', authHeader);
    next();
  });
};

const run = async () => {
  try {
    await client.connect();
    const servicesCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingsCollection = client
      .db("doctors_portal")
      .collection("bookings");
    const usersCollection = client.db("doctors_portal").collection("users");
    const doctorsCollection = client.db("doctors_portal").collection("doctors");
    const paymentsCollection = client
      .db("doctors_portal")
      .collection("payments");
    const reviewsCollection = client.db("doctors_portal").collection("reviews");

    // verifying admin
    const verifyAdmin = async (req, res, next) => {
      const requestedEmail = req.decoded.email;
      const requestedAccount = await usersCollection.findOne({
        email: requestedEmail,
      });
      if (requestedAccount?.role === "admin") {
        next();
      } else {
        res.status(403).send({
          message: "Request to the this route is not accessible and deniable",
        });
      }
    };

    // displaying services
    app.get("/services", async (req, res) => {
      const query = {};
      const cursor = servicesCollection.find(query).project({ title: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    // warning
    // displaying added appointment
    // this is irregular informal way to
    app.get("/available", async (req, res) => {
      const date = req.query.date; // || 'May 19, 2022';

      // step:1: services data
      const services = await servicesCollection.find().toArray();

      // step:2: bookings data
      const query = { date: date };
      const appointmentBookings = await bookingsCollection
        .find(query)
        .toArray();

      // step:3: displaying slotTime for avaiable booking
      // services?.forEach((service) => {
      // const serviceBookings = appointmentBookings.filter(
      //   (booking) => booking?.treatment === service?.title
      // );
      // console.log(serviceBookings);
      // const booked = serviceBookings?.map((s) => s?.patientSlotTime);
      // service.booked = booked;
      // const availableSlotTime = service?.slots?.filter(
      //   (serve) => !booked?.includes(serve)
      // );
      // service.availableSlotTime = availableSlotTime;
      // });

      // step:3: displaying slotTime for avaiable booking
      services?.forEach((service) => {
        // step:4: find bookings by speicfic service
        const serviceBookings = appointmentBookings?.filter(
          (booking) => booking?.treatment === service?.title
        );
        // step:5: select slots for serviceBookings
        const bookedSlots = serviceBookings?.map(
          (booking) => booking?.patientSlotTime
        );
        // step:6: select slot that are not in the bookedSlots
        const availableSlots = service?.slots?.filter(
          (available) => !bookedSlots?.includes(available)
        );
        // step:7: setting avaialble slot from both services and appointmentBookings
        service.availableSlots = availableSlots;
      });

      res.send(services);
    });

    // displaying appointment bookings according to patient's email
    // using verifyJWT as middleware
    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingsCollection.find(query).toArray();
        res.send(bookings);
      } else {
        res.status(403).send({ message: "Access is denied to this route" });
      }
    });

    // applying booking method by id and activating payment system
    app.get("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const bookingPayment = await bookingsCollection.findOne(query);
      res.send(bookingPayment);
    });

    // displaying all the users
    // using verifyJWT as middleware
    app.get("/users", verifyJWT, async (req, res) => {
      const query = {};
      const cursor = usersCollection.find(query);
      const allUsers = await cursor.toArray();
      res.send(allUsers);
    });

    // confirming admins account and displaying users for admin
    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      res.send({ admin: isAdmin });
    });

    // displaying all the doctors
    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const cursor = doctorsCollection.find(query);
      const doctors = await cursor.toArray();
      res.send(doctors);
    });

    // displaying all reviews
    app.get("/reviews", async (req, res) => {
      const query = {};
      const reviews = await reviewsCollection.find(query).toArray();
      res.send(reviews);
    });

    // adding booking
    app.post("/booking", async (req, res) => {
      // create a appointment to insert in booking colllection
      const appointmentBooking = req.body;
      // console.log(appointmentBooking);

      const query = {
        treatment: appointmentBooking?.treatment,
        date: appointmentBooking?.date,
        patient: appointmentBooking?.patient,
      };

      const bookingExists = await bookingsCollection.findOne(query);

      if (bookingExists) {
        return res.send({ success: false, appointmentBooking: bookingExists });
      } else {
        const result = await bookingsCollection.insertOne(appointmentBooking);
        res.send(result);
      }
    });

    // adding doctors details
    app.post("/doctor", verifyJWT, async (req, res) => {
      const doctor = req.body;
      const doctorsResult = await doctorsCollection.insertOne(doctor);
      res.send(doctorsResult);
    });

    // creating payment method for stripe after booking an appointment
    app.post("/createpaymentintent", verifyJWT, async (req, res) => {
      const service = req.body;
      const fee = service?.fee;
      const amount = fee * 100;
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // creating review
    app.post("/review", verifyJWT, async (req, res) => {
      const review = req.body;
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    // updating users or patients account
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      // this option instructs the method to create a document if no documents match the filter
      const options = { upsert: true };
      // create a document that sets the plot of the movie
      const updateUser = {
        $set: user,
      };

      const usersResult = await usersCollection.updateOne(
        filter,
        updateUser,
        options
      );
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "1d",
        }
      );
      res.send({ usersResult, accessToken: token });
    });

    // creating adminRole for from users to admins
    // using verifyJWT as middleware
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      // const requestedEmail = req.decoded.email;
      // const requestedAccount = await usersCollection.findOne({
      //   email: requestedEmail,
      // });
      // if (requestedAccount?.role === 'admin') {
      const filter = { email: email };
      // this option instructs the method to create a document if no documents match the filter
      // const options = { upsert: true }; // here user is updated to be admin and no new user data is inserting that's why this is commented
      // create a document that sets the plot of the movie
      const makeAdmin = {
        $set: { role: "admin" },
      };

      const adminsResult = await usersCollection.updateOne(filter, makeAdmin);

      res.send(adminsResult);
      // } else {
      //   res
      //     .status(403)
      //     .send({ message: 'Access to the this route is forbidden' });
      // }
    });

    // removing adminRole for from users to admins
    // using verifyJWT as middleware
    app.patch(
      "/user/admin/:email",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        // const requestedEmail = req.decoded.email;
        // const requestedAccount = await usersCollection.findOne({
        //   email: requestedEmail,
        // });
        // if (requestedAccount?.role === 'admin') {
        const filter = {
          email: email,
        };
        // this option instructs the method to create a document if no documents match the filter
        // const options = { upsert: true }; // here user is updated to be admin and no new user data is inserting that's why this is commented
        // create a document that sets the plot of the movie
        const removeAdmin = {
          $set: {
            role: "user",
          },
        };

        const adminsResult = await usersCollection.updateOne(
          filter,
          removeAdmin
        );

        res.send(adminsResult);
        // } else {
        //   res
        //     .status(403)
        //     .send({ message: 'Access to the this route is forbidden' });
        // }
      }
    );

    // updating booking method by id and activating payment system
    app.patch("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      // const options = { upsert: true };
      const updateBookingPayment = {
        $set: {
          paid: true,
          transactionId: payment?.transactionId,
        },
      };

      const resultPayments = await paymentsCollection.insertOne(payment);
      const updatedBookingPayment = await bookingsCollection.updateOne(
        filter,
        updateBookingPayment
        // options
      );
      res.send(updateBookingPayment);
    });

    // deleting doctors account by email
    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const deleteDoctor = await doctorsCollection.deleteOne(filter);
      res.send(deleteDoctor);
    });
  } finally {
    // await client.close();
  }
};
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
